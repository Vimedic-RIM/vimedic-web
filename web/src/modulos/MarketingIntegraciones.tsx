import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowDown, ArrowUp, Check, CircleCheck, Copy, Eye, FileBadge, FileText, Film, Globe, ImagePlus, KeyRound, Link2, Plug, RefreshCw, Search, Sparkles, Tag, Trash2, Upload, Video, X,
} from 'lucide-react'
import { supabase, type Perfil } from '../supabase'
import { agrupar } from '../tiempoReal'
import { IconoRed } from '../redes'
import { VisorMedios } from '../VisorMedios'
import { puede } from '../permisos'
import { imagen, Interruptor } from './inventarioUtil'
import { leerAjustesFicha, type AjustesFicha } from './MarketingRevision'
import { imagenWebp, subirCatalogo } from './audiovisualMedios'
import { encabezadoDocHtml, pieDocHtml } from '../documentoMarca'
import { PorCompletar, VideosPendientes, type DatosPendientes } from './MarketingPendientes'
import type { PendientePlan } from './MarketingPlan'

/* Conexiones de Marketing: Zernio (redes) y la IA (Claude; Gemini de respaldo). Las claves viven en el servidor (Edge Function): el navegador nunca las ve. */
/** Llama a la función de Drive y devuelve el motivo real si falla (no el genérico "non-2xx status code"). */
async function drive(body: Record<string, unknown>): Promise<{ resp: { id?: string; enlace?: string; error?: string } | null; error: { message: string } | null }> {
  try { return { resp: await llamar<{ id?: string; enlace?: string }>(String(body.accion), body, 'drive'), error: null } }
  catch (e) { return { resp: null, error: { message: (e as Error).message } } }
}
export async function llamar<T = Record<string, unknown>>(accion: string, datos: Record<string, unknown> = {}, funcion = 'marketing-integraciones'): Promise<T> {
  const { data, error } = await supabase.functions.invoke(funcion, { body: { accion, ...datos } })
  if (error) {
    let m = error.message
    try { const j = await (error as unknown as { context?: Response }).context?.json?.(); if (j?.error) m = j.error } catch { /* sin detalle */ }
    throw new Error(m)
  }
  if (data && (data as { error?: string }).error) throw new Error((data as { error: string }).error)
  return data as T
}

function Ventana({ titulo, cerrar, children, pie, ancho = 'sm:max-w-lg' }: { titulo: string; cerrar: () => void; children: React.ReactNode; pie: React.ReactNode; ancho?: string }) {
  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-[2px] z-[70] flex items-center justify-center p-0 sm:p-4" onClick={(e) => { if (e.target === e.currentTarget) cerrar() }}>
      <div className={'bg-white sm:rounded-2xl shadow-2xl w-full h-full sm:h-auto sm:max-h-[90vh] flex flex-col overflow-hidden ' + ancho}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 shrink-0"><h3 className="font-display font-bold text-sm text-slate-800">{titulo}</h3><button onClick={cerrar} className="text-slate-400 hover:text-slate-600" aria-label="Cerrar"><X className="w-4 h-4" /></button></div>
        <div className="flex-1 overflow-y-auto p-5 space-y-3">{children}</div>
        <div className="shrink-0 border-t border-slate-100 p-4 flex gap-2 items-center">{pie}</div>
      </div>
    </div>
  )
}

/* ============================ Configuración ============================ */
type Estado = { proveedor: string; configurado: boolean; vista: string; config: { modelo?: string }; estado_prueba: string | null; probado_en: string | null; actualizado: string | null }
/* Modelos de Gemini: la lista sale de Google (Edge Function, caché 24 h). El modelo de respaldo y las palabras
   que se excluyen están en un solo lugar: supabase/functions/_shared/gemini.ts. */
type ModelosIA = { modelos: { id: string; nombre: string }[]; actualizado: string | null; origen: 'google' | 'cache' | 'respaldo'; falla?: string; guardado: string; auto: string; migrado: string | null }
/* Claude (Anthropic): la IA de la plataforma. El primero es el de por defecto (igual que CLAUDE_MODELO en supabase/functions/_shared/ia.ts). */
const MODELOS_CLAUDE: [string, string][] = [
  ['claude-opus-5-5', 'Claude Opus 5.5 · máxima calidad (recomendado)'],
  ['claude-sonnet-5-5', 'Claude Sonnet 5.5 · más rápido y económico'],
  ['claude-haiku-5-5', 'Claude Haiku 5.5 · el más rápido, para textos cortos'],
]
const NOMBRE_TARJETA = { zernio: 'Zernio', claude: 'Claude', gemini: 'Gemini' } as const
const COLOR_TARJETA = { zernio: '#e1306c', claude: '#d97757', gemini: '#7c3aed' } as const

export function Configuracion({ aviso, alCambiar }: { aviso: (t: string) => void; alCambiar: () => void }) {
  const [estados, setEstados] = useState<Estado[] | null>(null)
  const [error, setError] = useState('')
  const cargar = useCallback(() => {
    supabase.rpc('integraciones_estado').then(({ data, error }) => { if (error) setError(error.message); else { setError(''); setEstados((data as Estado[]) ?? []) } })
  }, [])
  useEffect(() => { cargar() }, [cargar])
  if (error) return <div className="card p-6 text-sm text-amber-800 bg-amber-50 border-amber-200">{error}</div>
  if (!estados) return <p className="text-xs text-slate-400 p-4">Cargando conexiones…</p>
  const ver = (p: string) => estados.find((e) => e.proveedor === p) ?? { proveedor: p, configurado: false, vista: '', config: {}, estado_prueba: null, probado_en: null, actualizado: null }
  return (
    <section className="space-y-4">
      <div className="card p-4 text-xs text-slate-600 flex gap-3 items-start"><KeyRound className="w-4 h-4 mt-0.5 shrink-0 text-[var(--primary)]" />
        <p>Las claves se guardan <b>cifradas en el servidor</b> y solo las usa la aplicación para hablar con cada servicio: nadie puede verlas después de guardarlas, ni siquiera quien administra. Para cambiarlas, pega una nueva.</p></div>
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Tarjeta proveedor="zernio" titulo="Zernio · redes sociales" sub="Publica y programa en Facebook e Instagram desde el Planificador." est={ver('zernio')} aviso={aviso} cambio={() => { cargar(); alCambiar() }}
          ayuda="En el panel de Zernio crea una clave de API (API Keys) y pégala aquí. Es la misma que usaba la app anterior." />
        <Tarjeta proveedor="claude" titulo="Claude · inteligencia artificial" sub="Redacta publicaciones, descripciones y especificaciones de producto, y sugiere respuestas en el CRM." est={ver('claude')} aviso={aviso} cambio={() => { cargar(); alCambiar() }}
          ayuda="En console.anthropic.com entra a API Keys, crea una clave y pégala aquí. Mientras Claude esté conectado, toda la IA de la app usa Claude." modelosFijos={MODELOS_CLAUDE} />
        <Tarjeta proveedor="gemini" titulo="Gemini · IA de respaldo" sub={ver('claude').configurado ? 'No se usa: la IA de la app es Claude. Solo entra si desconectas Claude.' : 'Se usa solo mientras Claude no esté conectado.'} est={ver('gemini')} aviso={aviso} cambio={() => { cargar(); alCambiar() }}
          ayuda="Crea una clave en Google AI Studio (aistudio.google.com/apikey) y pégala aquí." conModelo />
        <TarjetaMetaLeads est={ver('meta_leads')} aviso={aviso} cambio={() => { cargar(); alCambiar() }} />
        <TarjetaWhatsapp aviso={aviso} />
        <TarjetaDrive est={ver('drive')} estApp={ver('google_app')} aviso={aviso} cambio={() => { cargar(); alCambiar() }} />
        <TarjetaPixel proveedor="meta_pixel" titulo="Meta Conversions API" color="#1877f2" est={ver('meta_pixel')} aviso={aviso} cambio={() => { cargar(); alCambiar() }} />
        <TarjetaPixel proveedor="tiktok_pixel" titulo="TikTok Events API" color="#000000" est={ver('tiktok_pixel')} aviso={aviso} cambio={() => { cargar(); alCambiar() }} />
      </div>
    </section>
  )
}

/* Meta Lead Ads → CRM: los formularios de Facebook e Instagram entran solos como leads y se reparten entre los
   asesores (Edge Function meta-leads). Token y clave secreta de la app cifrados en Vault. */
function TarjetaMetaLeads({ est, aviso, cambio }: { est: Estado; aviso: (t: string) => void; cambio: () => void }) {
  const cfg = est.config as { paginaId?: string; empresa?: string; verifyToken?: string; correo?: { activo?: boolean; diseno?: number; copia?: string } }
  const [correoActivo, setCorreoActivo] = useState(cfg.correo?.activo !== false)
  const [diseno, setDiseno] = useState([1, 2, 3].includes(Number(cfg.correo?.diseno)) ? Number(cfg.correo?.diseno) : 1)
  const [copia, setCopia] = useState(cfg.correo?.copia ?? '')
  const [vista, setVista] = useState<{ n: number; nombre: string; html: string }[] | null>(null)
  const [vistaSel, setVistaSel] = useState(1)
  const [paginaId, setPaginaId] = useState(cfg.paginaId ?? '')
  const [empresa, setEmpresa] = useState(cfg.empresa === 'FEMEDICS' ? 'FEMEDICS' : 'VIMEDIC')
  const [verifyToken] = useState(() => cfg.verifyToken || 'vm-' + crypto.randomUUID().replace(/-/g, '').slice(0, 24))
  const [token, setToken] = useState('')
  const [appSecret, setAppSecret] = useState('')
  const [dias, setDias] = useState(7)
  const [ocupado, setOcupado] = useState('')
  const prueba = est.estado_prueba ?? '', ok = prueba.startsWith('ok')
  const webhook = String(import.meta.env.VITE_SUPABASE_URL || '').replace(/\/$/, '') + '/functions/v1/meta-leads'
  const copiar = (t: string, que: string) => { navigator.clipboard?.writeText(t).then(() => aviso(que + ' copiado.'), () => aviso('No se pudo copiar: selecciónalo y cópialo a mano.')) }
  async function guardar() {
    if (!/^\d{5,30}$/.test(paginaId.trim())) { aviso('Pon el ID de la página de Facebook (solo números).'); return }
    if (!!token.trim() !== !!appSecret.trim()) { aviso('Pega el token y la clave secreta de la app juntos.'); return }
    if (!token.trim() && !est.configurado) { aviso('Pega el token de acceso y la clave secreta de la app.'); return }
    setOcupado('guardar')
    const { error } = await supabase.rpc('integracion_guardar', { p_proveedor: 'meta_leads', p_secreto: token.trim() ? JSON.stringify({ token: token.trim(), appSecret: appSecret.trim() }) : null, p_config: { paginaId: paginaId.trim(), empresa, verifyToken, appUrl: location.origin, correo: { activo: correoActivo, diseno, copia: copia.trim() } } })
    setOcupado('')
    if (error) { aviso('No se pudo guardar: ' + error.message); return }
    const nueva = !!token.trim(); setToken(''); setAppSecret(''); aviso(nueva ? 'Guardado. Probando y conectando la página…' : 'Configuración guardada.'); cambio()
    if (nueva) probar()
  }
  async function probar() {
    setOcupado('probar')
    try { const r = await llamar<{ ok: boolean; mensaje: string }>('probar', {}, 'meta-leads'); aviso(r.mensaje) } catch (e) { aviso((e as Error).message) }
    setOcupado(''); cambio()
  }
  async function traer() {
    setOcupado('traer')
    try {
      const r = await llamar<{ formularios: number; nuevos: number; ya: number; pruebas: number; fallos: number }>('traer', { dias }, 'meta-leads')
      aviso(`${r.formularios} formulario${r.formularios === 1 ? '' : 's'} revisado${r.formularios === 1 ? '' : 's'}: ${r.nuevos} lead${r.nuevos === 1 ? '' : 's'} nuevo${r.nuevos === 1 ? '' : 's'} en el CRM, ${r.ya} ya estaba${r.ya === 1 ? '' : 'n'}${r.pruebas ? ', ' + r.pruebas + ' de prueba' : ''}${r.fallos ? ', ' + r.fallos + ' con error' : ''}.`)
    } catch (e) { aviso((e as Error).message) }
    setOcupado('')
  }
  async function verDisenos() {
    setOcupado('vista')
    try { const r = await llamar<{ disenos: { n: number; nombre: string; html: string }[] }>('correo_vista', {}, 'meta-leads'); setVista(r.disenos); setVistaSel(diseno) } catch (e) { aviso((e as Error).message) }
    setOcupado('')
  }
  async function probarCorreo() {
    setOcupado('correo')
    try { const r = await llamar<{ para: string; enviados: number }>('correo_prueba', { diseno }, 'meta-leads'); aviso('Correo de prueba enviado a ' + r.para + '.') } catch (e) { aviso((e as Error).message) }
    setOcupado('')
  }
  async function quitar() {
    if (!confirm('¿Desconectar Meta? Los formularios dejarán de entrar al CRM hasta que vuelvas a conectarlo.')) return
    const { error } = await supabase.rpc('integracion_quitar', { p_proveedor: 'meta_leads' })
    if (error) aviso('No se pudo quitar: ' + error.message); else { aviso('Conexión eliminada.'); cambio() }
  }
  const fila = (etq: string, valor: string, que: string) => (
    <div className="mkml-copia"><small>{etq}</small><code>{valor}</code><button type="button" className="btn" onClick={() => copiar(valor, que)}><Copy />Copiar</button></div>
  )
  return (
    <article className="card p-5" style={{ gridColumn: "1 / -1" }}>
      <div className="flex items-start gap-3">
        <span className="w-10 h-10 rounded-xl grid place-items-center shrink-0" style={{ background: '#0866ff1A' }}><IconoRed red="meta" size={22} /></span>
        <div className="min-w-0 flex-1"><h3 className="font-display font-bold text-sm text-slate-800">Meta · formularios de clientes potenciales</h3>
          <p className="text-[11px] text-slate-500">Los formularios de los anuncios de Facebook e Instagram entran solos al CRM como gestión nueva y se reparten entre los asesores (reparto justo), con el anuncio, la campaña y las respuestas.</p></div>
        <span className="pill shrink-0" style={est.configurado ? (prueba && !ok ? { background: '#fdecea', color: '#c0392b' } : { background: '#ecfaf5', color: '#04896f' }) : { background: '#f1f5f9', color: '#64748b' }}>
          {est.configurado ? (prueba ? (ok ? 'Conectado' : 'Con error') : 'Sin probar') : 'No conectado'}</span>
      </div>
      <div className="mkml-grid">
        <div className="space-y-2">
          <label className="block text-[11px] font-bold text-slate-500">ID de la página de Facebook
            <input type="text" inputMode="numeric" value={paginaId} onChange={(e) => setPaginaId(e.target.value.replace(/\D/g, ''))} className="inp w-full mt-1" placeholder="Ej. 104512345678901" /></label>
          <label className="block text-[11px] font-bold text-slate-500">Los leads son de
            <select value={empresa} onChange={(e) => setEmpresa(e.target.value)} className="inp w-full mt-1"><option value="VIMEDIC">VIMEDIC</option><option value="FEMEDICS">FEMEDICS</option></select></label>
          <label className="block text-[11px] font-bold text-slate-500">Token de acceso (usuario del sistema){est.configurado && <span className="font-mono-spec font-normal text-slate-400"> · actual {est.vista}</span>}
            <input type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} className="inp w-full mt-1" placeholder={est.configurado ? 'Pega uno nuevo para reemplazarlo' : 'Pega aquí el token'} /></label>
          <label className="block text-[11px] font-bold text-slate-500">Clave secreta de la app (App Secret)
            <input type="password" autoComplete="off" value={appSecret} onChange={(e) => setAppSecret(e.target.value)} className="inp w-full mt-1" placeholder={est.configurado ? 'Solo si cambias el token' : 'Configuración de la app › Básica'} /></label>
        </div>
        <div className="space-y-2">
          <p className="text-[11px] font-bold text-slate-500">Para el webhook en la app de Meta (objeto «Page», campo «leadgen»)</p>
          {fila('URL de devolución', webhook, 'URL')}
          {fila('Token de verificación', verifyToken, 'Token de verificación')}
          {!cfg.verifyToken && <p className="text-[10.5px] text-amber-700">Primero pulsa «Guardar»: Meta comprueba este token al guardar el webhook.</p>}
          <div className="mkml-correo">
            <div className="flex items-center gap-2 text-[11.5px] font-bold text-slate-700"><Interruptor activo={correoActivo} cambiar={() => setCorreoActivo((a) => !a)} />Correo urgente al asesor que recibe el lead</div>
            {correoActivo && <>
              <label className="block text-[11px] font-bold text-slate-500 mt-2">Diseño del correo
                <select value={diseno} onChange={(e) => setDiseno(Number(e.target.value))} className="inp w-full mt-1"><option value={1}>1 · Alerta urgente</option><option value={2}>2 · Ficha del cliente</option><option value={3}>3 · Oscuro moderno</option></select></label>
              <label className="block text-[11px] font-bold text-slate-500 mt-2">Copia a (administrador, opcional)
                <input type="email" value={copia} onChange={(e) => setCopia(e.target.value)} className="inp w-full mt-1" placeholder="correo@vimedic.com.ec" /></label>
              <div className="flex gap-2 flex-wrap mt-2">
                <button type="button" className="btn" onClick={verDisenos} disabled={!!ocupado}><Eye />{ocupado === 'vista' ? 'Cargando…' : 'Ver los 3 diseños'}</button>
                <button type="button" className="btn" onClick={probarCorreo} disabled={!!ocupado}><Check />{ocupado === 'correo' ? 'Enviando…' : 'Enviarme una prueba'}</button>
              </div>
              <p className="text-[10.5px] text-slate-500 mt-1.5">Sale del Gmail conectado en «Google Drive». La primera vez pulsa ahí otra vez «Conectar con Google» y acepta «Enviar correo». Guarda para aplicar el diseño.</p>
            </>}
          </div>
          <details className="mkml-pasos"><summary>Paso a paso en Meta</summary><ol>
            <li>En <b>developers.facebook.com</b> crea (o abre) la app de tipo Negocio de VIMEDIC.</li>
            <li>En <b>Webhooks</b> elige «Page», pega la URL de devolución y el token de verificación de aquí y suscríbete al campo <b>leadgen</b>.</li>
            <li>En el <b>Business Manager › Usuarios del sistema</b> crea un usuario, asígnale la página y la app y genera un token con los permisos <code>leads_retrieval</code>, <code>pages_manage_metadata</code>, <code>pages_read_engagement</code>, <code>pages_show_list</code> y <code>pages_manage_ads</code>.</li>
            <li>En <b>Configuración del negocio › Integraciones › Acceso a clientes potenciales</b> da acceso a la app.</li>
            <li>Pega aquí el token, la clave secreta de la app y el ID de la página, y pulsa <b>Guardar</b>: la página queda conectada sola.</li>
            <li>Prueba con la <b>herramienta de prueba de anuncios para clientes potenciales</b> de Meta: aquí debe decir «Lead de prueba de Meta recibido» (los de prueba no entran al CRM).</li>
          </ol></details>
        </div>
      </div>
      {prueba && <p className="text-[11px] mt-3 rounded-lg px-3 py-2" style={ok ? { background: '#ecfaf5', color: '#04896f' } : { background: '#fdecea', color: '#a3341f' }}>{prueba.replace(/^(ok|error): /, '')}{est.probado_en ? ' · ' + new Date(est.probado_en).toLocaleString('es-EC', { dateStyle: 'short', timeStyle: 'short' }) : ''}</p>}
      <div className="flex gap-2 flex-wrap items-center mt-4">
        <button type="button" className="btn btn-primary" onClick={guardar} disabled={!!ocupado}><Check />{ocupado === 'guardar' ? 'Guardando…' : 'Guardar'}</button>
        <button type="button" className="btn" onClick={probar} disabled={!!ocupado || !est.configurado}><Plug />{ocupado === 'probar' ? 'Probando…' : 'Probar conexión'}</button>
        <span className="inline-flex items-center gap-1.5">
          <button type="button" className="btn" onClick={traer} disabled={!!ocupado || !est.configurado}><RefreshCw />{ocupado === 'traer' ? 'Trayendo…' : 'Traer leads'}</button>
          <select className="inp" value={dias} onChange={(e) => setDias(Number(e.target.value))} aria-label="Desde hace"><option value={1}>de hoy</option><option value={7}>de 7 días</option><option value={30}>de 30 días</option><option value={90}>de 90 días</option></select>
        </span>
        {est.configurado && <button type="button" className="btn ml-auto" style={{ color: '#b91c1c', borderColor: '#fecaca' }} onClick={quitar}><Trash2 />Desconectar</button>}
      </div>
      {vista && (
        <Ventana titulo="Correo al asesor · diseños" ancho="sm:max-w-6xl" cerrar={() => setVista(null)} pie={<>
          <div className="seg flex-1">{vista.map((v) => <button key={v.n} type="button" className={vistaSel === v.n ? 'active' : ''} onClick={() => setVistaSel(v.n)}>{v.n} · {v.nombre}</button>)}</div>
          <button type="button" className="btn btn-primary" onClick={() => { setDiseno(vistaSel); setVista(null); aviso('Diseño elegido. Pulsa «Guardar» para aplicarlo.') }}><Check />Usar este diseño</button>
        </>}>
          <iframe title="Vista del correo" srcDoc={vista.find((v) => v.n === vistaSel)?.html ?? ''} sandbox="" style={{ width: '100%', height: '70vh', border: '1px solid #e2e8f0', borderRadius: 12, background: '#fff' }} />
        </Ventana>
      )}
      <p className="text-[10.5px] text-slate-400 mt-2">«Traer leads» recupera los que no llegaron (Meta los guarda 90 días). No se duplican. Los de más de un día entran sin asesor: se asignan en CRM › Leads de Meta (reparto).</p>
    </article>
  )
}

/* WhatsApp en las publicaciones: al publicar en Facebook se agrega un enlace que abre el chat con un mensaje
   que dice de qué publicación viene; en Instagram, el número. El teléfono sale de Empleados. */
function TarjetaWhatsapp({ aviso }: { aviso: (t: string) => void }) {
  type Op = { id: string; nombre: string; cargo: string | null; termina: string }
  const [ops, setOps] = useState<Op[] | null>(null)
  const [emp, setEmp] = useState('')
  const [activo, setActivo] = useState(true)
  const [guardado, setGuardado] = useState<{ empleado_id?: string; activo?: boolean } | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    supabase.rpc('mkt_whatsapp_opciones').then(({ data, error }) => {
      if (error) { setError(error.message); return }
      const d = data as { actual: { empleado_id?: string; activo?: boolean } | null; empleados: Op[] }
      setOps(d.empleados ?? []); setGuardado(d.actual); setEmp(d.actual?.empleado_id ?? ''); setActivo(d.actual?.activo !== false)
    })
  }, [])
  async function guardar() {
    if (!emp) { aviso('Elige a quién le llegan los mensajes.'); return }
    setOcupado(true)
    const { data, error } = await supabase.rpc('mkt_whatsapp_guardar', { p_empleado: emp, p_activo: activo })
    setOcupado(false)
    if (error) { aviso('No se pudo guardar: ' + error.message); return }
    setGuardado(data as { empleado_id?: string; activo?: boolean }); aviso(activo ? 'Listo: las publicaciones de Facebook e Instagram llevarán el WhatsApp.' : 'WhatsApp en las publicaciones desactivado.')
  }
  const cambiado = !!guardado && (guardado.empleado_id !== emp || (guardado.activo !== false) !== activo)
  const elegido = ops?.find((o) => o.id === emp)
  return (
    <article className="card p-5">
      <div className="flex items-start gap-3">
        <span className="w-10 h-10 rounded-xl grid place-items-center shrink-0" style={{ background: '#25d3661A', color: '#128c4b' }}><Link2 className="w-5 h-5" /></span>
        <div className="min-w-0 flex-1"><h3 className="font-display font-bold text-sm text-slate-800">WhatsApp en las publicaciones</h3>
          <p className="text-[11px] text-slate-500">Facebook: enlace que abre el chat con «Vengo de su publicación en Facebook sobre…». Instagram: el número (allí los enlaces no se pueden tocar).</p></div>
        {guardado && <span className="pill shrink-0" style={guardado.activo !== false ? { background: '#ecfaf5', color: '#04896f' } : { background: '#f1f5f9', color: '#64748b' }}>{guardado.activo !== false ? 'Activo' : 'Apagado'}</span>}
      </div>
      {error ? <p className="text-[11px] text-amber-700 mt-3">{error}</p> : !ops ? <p className="text-[11px] text-slate-400 mt-3">Cargando…</p> : <>
        <label className="block text-[11px] font-bold text-slate-500 mt-3">Los mensajes le llegan a
          <select value={emp} onChange={(e) => setEmp(e.target.value)} className="inp w-full mt-1">
            <option value="">— Elegir —</option>
            {ops.map((o) => <option key={o.id} value={o.id}>{o.nombre}{o.cargo ? ' · ' + o.cargo : ''} · cel. …{o.termina}</option>)}
          </select></label>
        <p className="text-[10px] text-slate-400 mt-1">Solo aparecen empleados activos con celular en Empleados.{elegido ? ' Se usa el celular que termina en ' + elegido.termina + '.' : ''}</p>
        <div className="flex items-center gap-2 mt-3 text-[11px] font-bold text-slate-600"><Interruptor activo={activo} cambiar={() => setActivo((a) => !a)} />{activo ? 'Agregar el WhatsApp al publicar' : 'No agregar el WhatsApp'}</div>
        <div className="flex gap-2 flex-wrap mt-4">
          <button type="button" className="btn btn-primary" onClick={guardar} disabled={ocupado || (!cambiado && !!guardado)}><Check />{ocupado ? 'Guardando…' : 'Guardar'}</button>
        </div>
      </>}
    </article>
  )
}

/* Rastreo de conversiones del lado del servidor: además del píxel normal en el navegador, el
   servidor reporta el mismo evento por la API oficial de Meta/TikTok (mismo eventId, para que no
   se cuente doble). Evita perder eventos por bloqueadores de anuncios o restricciones de iOS/Safari. */
function TarjetaPixel({ proveedor, titulo, color, est, aviso, cambio }: {
  proveedor: 'meta_pixel' | 'tiktok_pixel'; titulo: string; color: string; est: Estado; aviso: (t: string) => void; cambio: () => void
}) {
  const cfg = est.config as { pixelId?: string }
  const [pixelId, setPixelId] = useState(cfg.pixelId ?? '')
  const [token, setToken] = useState('')
  const [ocupado, setOcupado] = useState('')
  const prueba = est.estado_prueba ?? '', ok = prueba.startsWith('ok')
  async function guardar() {
    if (!pixelId.trim()) { aviso('Pon el ID del píxel.'); return }
    if (!token.trim() && !est.configurado) { aviso('Pega el token de acceso.'); return }
    setOcupado('guardar')
    const { error } = await supabase.rpc('integracion_guardar', { p_proveedor: proveedor, p_secreto: token.trim() || null, p_config: { pixelId: pixelId.trim() } })
    setOcupado('')
    if (error) { aviso('No se pudo guardar: ' + error.message); return }
    const nueva = !!token.trim(); setToken(''); aviso(nueva ? 'Token guardado. Probando…' : 'ID del píxel actualizado.'); cambio()
    if (nueva) probar()
  }
  async function probar() {
    setOcupado('probar')
    try { const r = await llamar<{ mensaje: string }>('probar', { proveedor }); aviso(r.mensaje) } catch (e) { aviso((e as Error).message) }
    setOcupado(''); cambio()
  }
  async function quitar() {
    if (!confirm('¿Desconectar ' + titulo + '?')) return
    const { error } = await supabase.rpc('integracion_quitar', { p_proveedor: proveedor })
    if (error) aviso('No se pudo quitar: ' + error.message); else { setPixelId(''); aviso('Conexión eliminada.'); cambio() }
  }
  return (
    <article className="card p-5">
      <div className="flex items-start gap-3">
        <span className="w-10 h-10 rounded-xl grid place-items-center shrink-0" style={{ background: color + '1A', color }}><Tag className="w-5 h-5" /></span>
        <div className="min-w-0 flex-1"><h3 className="font-display font-bold text-sm text-slate-800">{titulo}</h3><p className="text-[11px] text-slate-500">Reporta conversiones (leads, ventas) desde el servidor, para no perder eventos por bloqueadores de anuncios o iOS.</p></div>
        <span className="pill shrink-0" style={est.configurado ? (prueba && !ok ? { background: '#fdecea', color: '#c0392b' } : { background: '#ecfaf5', color: '#04896f' }) : { background: '#f1f5f9', color: '#64748b' }}>
          {est.configurado ? (prueba ? (ok ? 'Conectado' : 'Con error') : 'Sin probar') : 'No conectado'}</span>
      </div>
      <label className="block text-[11px] font-bold text-slate-500 mt-3">ID del píxel
        <input type="text" value={pixelId} onChange={(e) => setPixelId(e.target.value)} className="inp w-full mt-1" placeholder="Ej. 123456789012345" /></label>
      <label className="block text-[11px] font-bold text-slate-500 mt-3">Token de acceso{est.configurado && <span className="font-mono-spec font-normal text-slate-400"> · actual {est.vista}</span>}
        <input type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} className="inp w-full mt-1" placeholder={est.configurado ? 'Pega uno nuevo para reemplazarlo' : 'Pega aquí el token'} /></label>
      {prueba && <p className="text-[11px] mt-3 rounded-lg px-3 py-2" style={ok ? { background: '#ecfaf5', color: '#04896f' } : { background: '#fdecea', color: '#a3341f' }}>{prueba.replace(/^(ok|error): /, '')}{est.probado_en ? ' · ' + new Date(est.probado_en).toLocaleString('es-EC', { dateStyle: 'short', timeStyle: 'short' }) : ''}</p>}
      <div className="flex gap-2 flex-wrap mt-4">
        <button type="button" className="btn btn-primary" onClick={guardar} disabled={!!ocupado}><Check />{ocupado === 'guardar' ? 'Guardando…' : 'Guardar'}</button>
        <button type="button" className="btn" onClick={probar} disabled={!!ocupado || !est.configurado}><Plug />{ocupado === 'probar' ? 'Probando…' : 'Probar conexión'}</button>
        {est.configurado && <button type="button" className="btn ml-auto" style={{ color: '#b91c1c', borderColor: '#fecaca' }} onClick={quitar}><Trash2 />Desconectar</button>}
      </div>
    </article>
  )
}

function Tarjeta({ proveedor, titulo, sub, est, aviso, cambio, ayuda, conModelo, modelosFijos }: { proveedor: 'zernio' | 'claude' | 'gemini'; titulo: string; sub: string; est: Estado; aviso: (t: string) => void; cambio: () => void; ayuda: string; conModelo?: boolean; modelosFijos?: [string, string][] }) {
  const [clave, setClave] = useState('')
  const [modelo, setModelo] = useState(est.config?.modelo || (modelosFijos ? modelosFijos[0][0] : 'auto'))
  const [ocupado, setOcupado] = useState('')
  const [cuentas, setCuentas] = useState<{ id: string; plataforma: string; nombre: string }[]>([])
  const [ia, setIa] = useState<ModelosIA | null>(null)
  const [iaError, setIaError] = useState('')
  const [cargandoIa, setCargandoIa] = useState(false)
  const prueba = est.estado_prueba ?? ''
  const ok = prueba.startsWith('ok')
  /* Lista de modelos de Google (o la guardada de las últimas 24 h). sincronizar = mostrar lo que quedó guardado
     (al abrir y después de probar: la autorreparación pudo cambiar el modelo). */
  async function cargarModelos(forzar = false, sincronizar = false) {
    setCargandoIa(true)
    try {
      const r = await llamar<ModelosIA>('gemini_modelos', { forzar })
      setIa(r); setIaError('')
      if (r.migrado) { setModelo('auto'); aviso('El modelo guardado (' + r.migrado + ') ya no está disponible en Google: se cambió a Automático.') }
      else if (sincronizar) setModelo(r.guardado)
      if (forzar && !r.falla) aviso('Lista de modelos actualizada: ' + r.modelos.length + ' modelos de texto.')
    } catch (e) { setIaError((e as Error).message) }
    setCargandoIa(false)
  }
  useEffect(() => { if (conModelo) cargarModelos(false, true) }, []) // eslint-disable-line react-hooks/exhaustive-deps
  async function guardar() {
    if (!clave.trim() && !conModelo && !(modelosFijos && est.configurado)) { aviso('Pega la clave primero.'); return }
    setOcupado('guardar')
    const { error } = await supabase.rpc('integracion_guardar', { p_proveedor: proveedor, p_secreto: clave.trim() || null, p_config: conModelo || modelosFijos ? { modelo } : {} })
    setOcupado('')
    if (error) { aviso('No se pudo guardar: ' + error.message); return }
    const nueva = !!clave.trim(); setClave(''); aviso(nueva ? 'Clave guardada. Probando la conexión…' : 'Configuración guardada.'); cambio()
    if (nueva) probarYListar(true)
  }
  async function probar() { await probarYListar(false) }
  async function probarYListar(claveNueva: boolean) {
    setOcupado('probar')
    try {
      const r = await llamar<{ ok: boolean; mensaje: string; extra?: typeof cuentas }>('probar', { proveedor })
      if (proveedor === 'zernio') setCuentas(r.extra ?? [])
      aviso(r.mensaje)
    } catch (e) { aviso((e as Error).message) }
    setOcupado(''); cambio()
    if (conModelo) cargarModelos(claveNueva, true) // con clave nueva, la lista se pide otra vez a Google
  }
  const usando = modelo === 'auto' ? ia?.auto : modelo
  const fechaLista = ia?.actualizado ? new Date(ia.actualizado).toLocaleString('es-EC', { dateStyle: 'short', timeStyle: 'short' }) : ''
  async function quitar() {
    if (!confirm('¿Desconectar ' + NOMBRE_TARJETA[proveedor] + '? ' + (proveedor === 'claude' ? 'La IA pasará a Gemini (si está conectado) hasta que pegues una clave nueva.' : 'Dejará de funcionar hasta que pegues una clave nueva.'))) return
    const { error } = await supabase.rpc('integracion_quitar', { p_proveedor: proveedor })
    if (error) aviso('No se pudo quitar: ' + error.message); else { setCuentas([]); aviso('Conexión eliminada.'); cambio() }
  }
  return (
    <article className="card p-5">
      <div className="flex items-start gap-3">
        <span className="w-10 h-10 rounded-xl grid place-items-center shrink-0" style={{ background: COLOR_TARJETA[proveedor] + '1A', color: COLOR_TARJETA[proveedor] }}>{proveedor === 'zernio' ? <Link2 className="w-5 h-5" /> : <Sparkles className="w-5 h-5" />}</span>
        <div className="min-w-0 flex-1"><h3 className="font-display font-bold text-sm text-slate-800">{titulo}</h3><p className="text-[11px] text-slate-500">{sub}</p></div>
        <span className="pill shrink-0" style={est.configurado ? (prueba && !ok ? { background: '#fdecea', color: '#c0392b' } : { background: '#ecfaf5', color: '#04896f' }) : { background: '#f1f5f9', color: '#64748b' }}>
          {est.configurado ? (prueba ? (ok ? 'Conectado' : 'Con error') : 'Sin probar') : 'No conectado'}</span>
      </div>
      <p className="text-[11px] text-slate-500 mt-3">{ayuda}</p>
      <label className="block text-[11px] font-bold text-slate-500 mt-3">Clave de API{est.configurado && <span className="font-mono-spec font-normal text-slate-400"> · actual {est.vista}</span>}
        <input type="password" autoComplete="off" value={clave} onChange={(e) => setClave(e.target.value)} className="inp w-full mt-1" placeholder={est.configurado ? 'Pega una nueva para reemplazarla' : 'Pega aquí la clave'} /></label>
      {modelosFijos && (
        <label className="block text-[11px] font-bold text-slate-500 mt-3">Modelo de IA
          <select value={modelo} onChange={(e) => setModelo(e.target.value)} className="inp w-full mt-1">
            {!modelosFijos.some(([v]) => v === modelo) && <option value={modelo}>{modelo}</option>}
            {modelosFijos.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
          </select></label>
      )}
      {conModelo && (<>
        <label className="block text-[11px] font-bold text-slate-500 mt-3">Modelo de IA
          <select value={modelo} onChange={(e) => setModelo(e.target.value)} className="inp w-full mt-1">
            <option value="auto">Automático · siempre el más reciente (recomendado)</option>
            {modelo !== 'auto' && !ia?.modelos.some((m) => m.id === modelo) && <option value={modelo}>{modelo}</option>}
            {(ia?.modelos ?? []).map((m) => <option key={m.id} value={m.id}>{m.nombre}</option>)}
          </select></label>
        <div className="flex items-center gap-1 flex-wrap mt-1 text-[10px] text-slate-500">
          <span className="min-w-0">
            {ia ? <>Usando: <b className="font-mono-spec">{usando}</b> · {ia.origen === 'respaldo' ? 'lista de respaldo' : 'lista actualizada ' + fechaLista}</>
              : iaError ? <span className="text-amber-700">No se pudo cargar la lista de modelos: {iaError}</span>
                : 'Consultando los modelos de Google…'}
          </span>
          <button type="button" className="inline-flex items-center gap-1 font-bold ml-auto" style={{ color: 'var(--primary)' }} onClick={() => cargarModelos(true)} disabled={cargandoIa}>
            <RefreshCw className="w-3 h-3" />{cargandoIa ? 'Actualizando…' : 'Actualizar lista de modelos'}</button>
        </div>
        {ia?.falla && <p className="text-[10px] text-amber-700 mt-1">Google no entregó la lista ({ia.falla}): se usa {ia.origen === 'cache' ? 'la última lista guardada' : 'una lista mínima de respaldo'}.</p>}
      </>)}
      {prueba && <p className="text-[11px] mt-3 rounded-lg px-3 py-2" style={ok ? { background: '#ecfaf5', color: '#04896f' } : { background: '#fdecea', color: '#a3341f' }}>{prueba.replace(/^(ok|error): /, '')}{est.probado_en ? ' · ' + new Date(est.probado_en).toLocaleString('es-EC', { dateStyle: 'short', timeStyle: 'short' }) : ''}</p>}
      {cuentas.length > 0 && <div className="flex flex-wrap gap-1.5 mt-3">{cuentas.map((c) => <span key={c.id} className="pill" style={{ background: '#eff6ff', color: '#055c9d', display: 'inline-flex', alignItems: 'center', gap: 5 }}><IconoRed red={c.plataforma} size={12} />{c.nombre}</span>)}</div>}
      <div className="flex gap-2 flex-wrap mt-4">
        <button type="button" className="btn btn-primary" onClick={guardar} disabled={!!ocupado}><Check />{ocupado === 'guardar' ? 'Guardando…' : 'Guardar'}</button>
        <button type="button" className="btn" onClick={probar} disabled={!!ocupado || !est.configurado}><Plug />{ocupado === 'probar' ? 'Probando…' : 'Probar conexión'}</button>
        {est.configurado && <button type="button" className="btn ml-auto" style={{ color: '#b91c1c', borderColor: '#fecaca' }} onClick={quitar}><Trash2 />Desconectar</button>}
      </div>
    </article>
  )
}

/* El planificador de publicaciones está en MarketingPlanificador.tsx. */

/* ============================ Biblioteca (descripciones con IA) ============================ */
export type Prod = {
  id: string; codigo: string; nombre: string; descripcion: string | null; imagen_url: string | null; categoria: { nombre: string } | null; marca: string | null
  drive_carpeta_url: string | null; ficha_tecnica_url: string | null; fecha_creacion: string | null; sin_etiqueta_nuevo: boolean; en_catalogo: boolean
}
const DIAS_NUEVO = 30
const normalize = (s: string) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
function prodReciente(p: Prod) { const t = p.fecha_creacion ? Date.parse(p.fecha_creacion) : NaN; return isFinite(t) && Date.now() - t < DIAS_NUEVO * 864e5 }
function prodFaltan(p: Prod, tieneGaleria: boolean) {
  const f: string[] = []
  if (!p.imagen_url) f.push('imagen')
  if (!String(p.descripcion || '').trim()) f.push('descripción')
  if (!p.ficha_tecnica_url) f.push('ficha')
  if (!p.drive_carpeta_url && !tieneGaleria) f.push('álbum o galería')
  return f
}
function prodEsNuevo(p: Prod) { return prodReciente(p) && !p.sin_etiqueta_nuevo }

export function Biblioteca({ perfil, aviso, asignar }: { perfil: Perfil; aviso: (t: string) => void; asignar?: (p: PendientePlan) => void }) {
  const [productos, setProductos] = useState<Prod[]>([])
  const [galCount, setGalCount] = useState<Record<string, number>>({})
  const [cargando, setCargando] = useState(true)
  const [q, setQ] = useState('')
  const [cat, setCat] = useState('')
  const [miss, setMiss] = useState('')
  const [limite, setLimite] = useState(48)
  const [sel, setSel] = useState<Prod | null>(null)
  const centinela = useRef<HTMLDivElement>(null)
  // Vistas del original: Productos, Por completar y Videos pendientes (mkfPendientes).
  const [vista, setVista] = useState<'productos' | 'pendientes' | 'videos'>('productos')
  const [pend, setPend] = useState<DatosPendientes | null>(null)
  const [pendError, setPendError] = useState('')
  const cargarPend = useCallback(() => {
    supabase.rpc('mkt_pendientes').then(({ data, error }) => { if (error) setPendError(error.message); else { setPendError(''); setPend(data as DatosPendientes) } })
  }, [])
  useEffect(() => { if (vista !== 'productos' && !pend) cargarPend() }, [vista, pend, cargarPend])
  const abrirPorId = (id: string) => { const x = productos.find((y) => y.id === id); if (x) setSel(x); else aviso('Ese producto todavía se está cargando; intenta en un momento.') }

  const cargar = useCallback(() => {
    setCargando(true)
    ;(async () => {
      const PAGE = 1000
      // Supabase corta cada respuesta en ~1000 filas sin importar el .limit() pedido:
      // hay que paginar con .range() hasta que una página vuelva incompleta.
      const todos: Prod[] = []
      for (let desde = 0; ; desde += PAGE) {
        const { data, error } = await supabase.from('productos')
          .select('id,codigo,nombre,descripcion,imagen_url,marca,drive_carpeta_url,ficha_tecnica_url,fecha_creacion,sin_etiqueta_nuevo,en_catalogo,categoria:categorias(nombre)')
          .is('deleted_at', null).or('estado.is.null,estado.not.ilike.inactivo').order('en_catalogo', { ascending: false }).order('nombre').order('id')
          .range(desde, desde + PAGE - 1)
        const pagina = (data as unknown as Prod[]) ?? []
        if (error || !pagina.length) break
        todos.push(...pagina)
        if (pagina.length < PAGE) break
      }
      setProductos(todos); setCargando(false)
      try { const abrir = sessionStorage.getItem('vm_mk_abrir_prod'); if (abrir) { sessionStorage.removeItem('vm_mk_abrir_prod'); const p = todos.find((x) => x.id === abrir); if (p) setSel(p) } } catch { /* sin almacenamiento */ }

      const c: Record<string, number> = {}
      for (let desde = 0; ; desde += PAGE) {
        const { data, error } = await supabase.from('producto_galeria').select('producto_id').is('deleted_at', null).order('id').range(desde, desde + PAGE - 1)
        const pagina = (data as { producto_id: string }[]) ?? []
        if (error || !pagina.length) break
        for (const g of pagina) c[g.producto_id] = (c[g.producto_id] ?? 0) + 1
        if (pagina.length < PAGE) break
      }
      setGalCount(c)
    })()
  }, [])
  useEffect(() => { cargar() }, [cargar])

  const categorias = useMemo(() => [...new Set(productos.map((p) => p.categoria?.nombre).filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b, 'es')), [productos])
  const marcas = useMemo(() => [...new Set(productos.map((p) => p.marca).filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b, 'es')), [productos])

  const filtrados = useMemo(() => {
    const palabras = normalize(q).split(/\s+/).filter(Boolean)
    return productos.filter((p) => {
      if (palabras.length) {
        const haystack = normalize([p.codigo, p.nombre, p.categoria?.nombre, p.marca].join(' '))
        if (!palabras.every((w) => haystack.includes(w))) return false
      }
      if (cat && p.categoria?.nombre !== cat) return false
      const tieneGal = !!galCount[p.id]
      const faltan = prodFaltan(p, tieneGal)
      if (miss === 'inc' && !(prodReciente(p) && faltan.length)) return false
      if (miss === 'img' && p.imagen_url) return false
      if (miss === 'desc' && String(p.descripcion || '').trim()) return false
      if (miss === 'ficha' && p.ficha_tecnica_url) return false
      if (miss === 'album' && (p.drive_carpeta_url || tieneGal)) return false
      return true
    }).map((p) => ({ p, reciente: prodReciente(p), faltan: prodFaltan(p, !!galCount[p.id]) }))
      // Prioridad: visibles en la web pública primero, luego nuevos incompletos, luego el resto.
      .sort((a, b) => (Number(b.p.en_catalogo) - Number(a.p.en_catalogo)) || (Number(b.reciente && b.faltan.length > 0) - Number(a.reciente && a.faltan.length > 0)))
  }, [productos, q, cat, miss, galCount])

  const pendientes = useMemo(() => productos.filter((p) => prodReciente(p) && prodFaltan(p, !!galCount[p.id]).length).length, [productos, galCount])

  // Scroll infinito: cuando el centinela entra en pantalla, se revela más de la lista ya cargada.
  useEffect(() => {
    const el = centinela.current
    if (!el) return
    const obs = new IntersectionObserver((entradas) => { if (entradas[0]?.isIntersecting) setLimite((l) => l + 48) }, { rootMargin: '600px' })
    obs.observe(el)
    return () => obs.disconnect()
  }, [filtrados.length])

  const nPend = pend ? pend.productos.filter((x) => x.estado !== 'completo').length : 0
  const nVid = pend ? pend.productos.filter((x) => !x.videos).length : 0
  const cambiarVista = (
    <div className="seg mb-3">
      {([['productos', 'Productos', 0], ['pendientes', 'Por completar', nPend], ['videos', 'Videos pendientes', nVid]] as const).map(([k, t, n]) => (
        <button key={k} type="button" className={vista === k ? 'active' : ''} onClick={() => setVista(k)}>{t}{n > 0 && <span className="rv-badge" style={{ background: '#64748b' }}>{n}</span>}</button>))}
    </div>
  )
  if (vista !== 'productos') return (
    <section>
      <div className="flex items-center gap-2 flex-wrap">{cambiarVista}<button type="button" className="btn mb-3 ml-auto" onClick={cargarPend}><RefreshCw className="w-3.5 h-3.5" />Actualizar</button></div>
      {pendError && <div className="rv-vacio">{pendError}</div>}
      {!pendError && !pend && <p className="text-xs text-slate-400">Cargando…</p>}
      {pend && (vista === 'pendientes' ? <PorCompletar datos={pend} abrir={abrirPorId} asignar={asignar} /> : <VideosPendientes datos={pend} abrir={abrirPorId} asignar={asignar} />)}
      {sel && <EditorProducto perfil={perfil} prod={sel} categorias={categorias} marcas={marcas} cerrar={() => { setSel(null); cargarPend() }} aviso={aviso} />}
    </section>
  )

  return (
    <section>
      {cambiarVista}
      <div className="flex items-center gap-2 flex-wrap mb-3">
        <div className="relative flex-1 min-w-[220px] max-w-md"><Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input type="search" value={q} onChange={(e) => { setQ(e.target.value); setLimite(48) }} placeholder="Buscar nombre, categoría o código…" className="inp pl-9 w-full" /></div>
        <select className="inp" value={cat} onChange={(e) => { setCat(e.target.value); setLimite(48) }} aria-label="Categoría">
          <option value="">Todas las categorías</option>{categorias.map((c) => <option key={c}>{c}</option>)}
        </select>
        <select className="inp" value={miss} onChange={(e) => { setMiss(e.target.value); setLimite(48) }} aria-label="Faltantes">
          <option value="">Todos</option><option value="inc">Nuevos por completar</option><option value="img">Sin imagen</option><option value="desc">Sin descripción</option><option value="ficha">Sin ficha</option><option value="album">Sin álbum</option>
        </select>
        <button type="button" className="btn" onClick={cargar}><RefreshCw className="w-3.5 h-3.5" />Actualizar</button>
        <span className="text-[11px] text-slate-500 ml-auto">{cargando ? 'Cargando biblioteca…' : productos.length + ' productos' + (pendientes ? ' · ' + pendientes + ' nuevo' + (pendientes === 1 ? '' : 's') + ' por completar' : '')}</span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3">
        {filtrados.slice(0, limite).map(({ p, faltan, reciente }) => (
          <button type="button" key={p.id} className="av-card text-left flex flex-col" onClick={() => setSel(p)}>
            <div className="aspect-square bg-slate-100 overflow-hidden relative">
              {p.imagen_url
                ? <img loading="lazy" src={imagen(p.imagen_url, 320)} alt="" className="w-full h-full object-cover" onError={(e) => { e.currentTarget.style.visibility = 'hidden' }} />
                : <span className="w-full h-full grid place-items-center text-slate-300"><ImagePlus className="w-7 h-7" /></span>}
              {prodEsNuevo(p) && <span className="absolute top-1.5 left-1.5 text-[9px] font-bold uppercase tracking-wider text-white bg-[#c98a1f] rounded-full px-2 py-0.5">Nuevo</span>}
            </div>
            <div className="p-2.5 flex-1 flex flex-col">
              <p className="text-[10px] font-mono-spec text-slate-400 truncate">{p.codigo}{p.categoria ? ' · ' + p.categoria.nombre : ''}</p>
              <p className="text-xs font-bold text-slate-800 mt-0.5 line-clamp-2">{p.nombre}</p>
              {reciente && faltan.length > 0 && <p className="text-[10px] text-amber-700 mt-1 line-clamp-2">Falta: {faltan.join(', ')}</p>}
              <div className="flex gap-1 mt-auto pt-2 flex-wrap">
                <span className={'pill ' + (p.imagen_url ? 'bg-sky-50 text-sky-700' : 'bg-red-50 text-red-600')}>{p.imagen_url ? 'Img' : 'Sin img'}</span>
                <span className={'pill ' + (String(p.descripcion || '').trim() ? 'bg-indigo-50 text-indigo-700' : 'bg-slate-100 text-slate-400')}>Desc</span>
                <span className={'pill ' + (p.ficha_tecnica_url ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-400')}>Ficha</span>
                <span className={'pill ' + ((p.drive_carpeta_url || galCount[p.id]) ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-400')}>Álbum</span>
              </div>
            </div>
          </button>
        ))}
        {!cargando && !filtrados.length && <p className="col-span-full p-8 text-center text-sm text-slate-400">No hay productos con estos filtros.</p>}
      </div>
      {filtrados.length > limite && <div ref={centinela} className="py-6 text-center text-[11px] text-slate-400">Cargando más productos…</div>}
      {sel && <EditorProducto perfil={perfil} prod={sel} categorias={categorias} marcas={marcas} cerrar={() => setSel(null)} aviso={aviso} />}
    </section>
  )
}

/* Campos de "Datos del producto" que se editan directo o pasan por Revisión,
   igual que ya funcionaba Descripción (marketing_cambios + permiso 'aprobar').
   'modelo' vive en la columna codigo_unico y 'publico' en en_catalogo. */
const CAMPO_COL: Record<string, string> = { modelo: 'codigo_unico', publico: 'en_catalogo', nuevo: 'sin_etiqueta_nuevo', album: 'drive_carpeta_url', ficha: 'ficha_tecnica_url' }
const CAMPOS_BOOL = ['publico', 'nuevo']
export const CAMPOS_PRODUCTO = ['descripcion', 'nombre', 'categoria', 'marca', 'modelo', 'garantia', 'accesorios', 'certificaciones', 'caracteristicas', 'especificaciones', 'publico', 'imagen_url', 'nuevo', 'album', 'ficha', 'destacados']

export async function aplicarCampoProducto(productoId: string, campo: string, valorNuevo: string): Promise<string | null> {
  if (campo === 'categoria') {
    const nombre = valorNuevo.trim()
    let categoria_id: string | null = null
    if (nombre) {
      const { data: existente } = await supabase.from('categorias').select('id').ilike('nombre', nombre).maybeSingle()
      if (existente) categoria_id = existente.id
      else {
        const nueva = crypto.randomUUID()
        const { error } = await supabase.from('categorias').insert({ id: nueva, nombre })
        if (error) return error.message
        categoria_id = nueva
      }
    }
    const { error } = await supabase.from('productos').update({ categoria_id }).eq('id', productoId)
    return error?.message ?? null
  }
  const col = CAMPO_COL[campo] ?? campo
  const valor: string | boolean | null = CAMPOS_BOOL.includes(campo) ? valorNuevo === 'SI' : (valorNuevo.trim() || null)
  const { error } = await supabase.from('productos').update({ [col]: valor }).eq('id', productoId)
  return error?.message ?? null
}

type ProdFull = {
  nombre: string; categoria: string; marca: string; codigo_unico: string; garantia: string; accesorios: string; certificaciones: string
  caracteristicas: string; especificaciones: string; destacados: string; ficha_tecnica_url: string
  pvp: number; aplica_iva: boolean; en_catalogo: boolean; imagen_url: string; descripcion: string; drive_carpeta_url: string
}
type GalItem = { id: string; tipo: 'imagen' | 'video'; archivo_url: string; descripcion: string | null; orden: number; tipo_video?: string | null }
const TIPOS_VIDEO = ['Comercial', 'Informativo', 'Reel para redes', 'Técnico', 'Demostración en uso', 'Testimonio']
type DocTecnico = { id: string; tipo: string; nombre: string; url: string | null }
const DOC_TIPOS = ['Manual de usuario', 'Manual de servicio', 'Hoja de datos del fabricante', 'Certificado', 'Registro sanitario', 'Otro']
const DOC_OBLIGATORIOS = ['Manual de usuario', 'Hoja de datos del fabricante', 'Registro sanitario']
type Ficha = { version: number; url: string; fecha: string }
type Especificacion = { dato: string; valor: string }

function construirFichaHtml(full: ProdFull, codigo: string, destacadosSel: string[], especs: Especificacion[], aj?: AjustesFicha | null): string {
  const esc = (v: unknown) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const car = full.caracteristicas.split('\n').map((x) => x.trim()).filter(Boolean)
  // Certificaciones del producto; si no tiene, las de los Ajustes de la ficha (Revisión › Ajustes).
  const certs = (full.certificaciones.trim() ? full.certificaciones : aj?.certificaciones ?? '').split(/[,;·\n]/).map((x) => x.trim()).filter(Boolean)
  const contacto = [aj?.web || 'vimedic.com.ec', aj?.telefono, aj?.correo].filter(Boolean).map((x) => esc(x)).join(' · ')
  const destacadosEsp = destacadosSel.length ? especs.filter((e) => destacadosSel.includes(e.dato)) : especs.slice(0, 3)
  return `<style>
    .ft-page{font-family:Arial,sans-serif;color:#0b2545;font-size:12px;width:210mm;min-height:297mm;box-sizing:border-box;padding:16mm;margin:0 auto;background:#fff}
    .ft-head{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #055c9d;padding-bottom:10px;margin-bottom:14px}
    .ft-tag{display:inline-block;border:2px solid #055c9d;color:#055c9d;font-weight:bold;letter-spacing:2px;padding:4px 12px;border-radius:8px;font-size:12px}
    .ft-img{display:block;margin:0 auto 14px;max-width:70mm;max-height:60mm;object-fit:contain}
    .ft-destacados{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px}
    .ft-chip{background:#eef6fd;border:1px solid #cfe3f5;border-radius:8px;padding:6px 10px;font-size:10.5px}
    .ft-tabla{width:100%;border-collapse:collapse;margin:8px 0}
    .ft-tabla td{padding:5px 8px;border-bottom:1px solid #e2e8f0;font-size:11px}
    .ft-car{margin:0;padding:0;list-style:none}
    .ft-car li{padding:3px 0;font-size:11px}
    .ft-cert{display:inline-block;background:#f0fdf8;border:1px solid #bfe6da;color:#04896f;border-radius:999px;padding:3px 10px;font-size:10px;margin:0 4px 4px 0}
  </style>
  <div class="ft-page">
    ${encabezadoDocHtml({ titulo: 'Ficha técnica', etiqueta: 'CÓDIGO', numero: codigo, fecha: new Date().toLocaleDateString('es-EC') })}
    <h1 style="font-size:17px;margin:0 0 2px">${esc(full.nombre)}</h1>
    <p style="font-size:11px;color:#64748b;margin:0 0 12px">${[full.marca, full.codigo_unico, full.categoria].filter(Boolean).map(esc).join(' · ')}</p>
    ${full.imagen_url ? `<img class="ft-img" src="${esc(full.imagen_url)}">` : ''}
    ${destacadosEsp.length ? `<div class="ft-destacados">${destacadosEsp.map((e) => `<span class="ft-chip"><b>${esc(e.dato)}:</b> ${esc(e.valor)}</span>`).join('')}</div>` : ''}
    ${full.descripcion ? `<p style="font-size:11.5px;line-height:1.5">${esc(full.descripcion)}</p>` : ''}
    ${car.length ? `<h3 style="font-size:12px;margin:14px 0 4px">Características</h3><ul class="ft-car">${car.map((c) => `<li>✓ ${esc(c)}</li>`).join('')}</ul>` : ''}
    ${especs.length ? `<h3 style="font-size:12px;margin:14px 0 4px">Especificaciones técnicas</h3><table class="ft-tabla">${especs.map((e) => `<tr><td style="font-weight:bold;width:40%">${esc(e.dato)}</td><td>${esc(e.valor)}</td></tr>`).join('')}</table>` : ''}
    ${full.garantia ? `<p style="font-size:11px;margin-top:10px"><b>Garantía:</b> ${esc(full.garantia)}</p>` : ''}
    ${certs.length ? `<div style="margin-top:8px">${certs.map((c) => `<span class="ft-cert">${esc(c)}</span>`).join('')}</div>` : ''}
    ${pieDocHtml(null, `${contacto} · ${esc(codigo)}`)}
  </div>`
}
const WEB = 'vimedic.com.ec'
const money = (n: number) => '$' + (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/* Completar con IA desde los documentos técnicos (ia_completar): la IA lee la hoja de datos / manuales y propone
   los campos que necesita la web y la ficha técnica. Nada se guarda sin revisar: se aplica campo por campo (o a Revisión). */
type PropuestaIA = { propuesta: Record<string, string>; notas: string; leidos: string[]; omitidos: string[] }
const CAMPOS_IA: [string, keyof ProdFull, string][] = [
  ['descripcion', 'descripcion', 'Descripción'], ['caracteristicas', 'caracteristicas', 'Características'], ['especificaciones', 'especificaciones', 'Especificaciones técnicas'],
  ['destacados', 'destacados', 'Datos destacados de la ficha'], ['accesorios', 'accesorios', 'Accesorios incluidos'], ['certificaciones', 'certificaciones', 'Certificaciones'],
  ['garantia', 'garantia', 'Garantía'], ['marca', 'marca', 'Marca'], ['modelo', 'codigo_unico', 'Modelo'],
]

export function EditorProducto({ perfil, prod, categorias, marcas, cerrar, aviso, encabezado }: { perfil: Perfil; prod: Prod; categorias: string[]; marcas: string[]; cerrar: () => void; aviso: (t: string) => void; encabezado?: React.ReactNode }) {
  const [full, setFull] = useState<ProdFull | null>(null)
  const [base, setBase] = useState<Record<string, string>>({})
  const [notas, setNotas] = useState('')
  const [ia, setIa] = useState(false)
  const [msg, setMsg] = useState('')
  const [estado, setEstado] = useState<Record<string, 'guardando' | 'ok' | 'revision' | 'error'>>({})
  const [galeria, setGaleria] = useState<GalItem[]>([])
  const [nuevoTipo, setNuevoTipo] = useState<'imagen' | 'video'>('imagen')
  const [nuevoUrl, setNuevoUrl] = useState('')
  const [avPicker, setAvPicker] = useState(false)
  const [visor, setVisor] = useState<number | null>(null) // galería ampliada (índice)
  const [avLista, setAvLista] = useState<{ id: string; titulo: string; archivo_url: string; tipo: string }[]>([])
  const [sinNuevo, setSinNuevo] = useState(prod.sin_etiqueta_nuevo)
  const [docs, setDocs] = useState<DocTecnico[]>([])
  const [docTipo, setDocTipo] = useState(DOC_TIPOS[0])
  const [docSubiendo, setDocSubiendo] = useState(false)
  const [iaComp, setIaComp] = useState<(PropuestaIA & { sel: Record<string, boolean>; val: Record<string, string> }) | null>(null)
  const [iaCompMsg, setIaCompMsg] = useState('')
  const [aplicandoIa, setAplicandoIa] = useState(false)
  const [ficha, setFicha] = useState<Ficha | null>(null)
  const [ajustes, setAjustes] = useState<AjustesFicha | null>(null)
  useEffect(() => { leerAjustesFicha().then(setAjustes).catch(() => undefined) }, [])
  const [generando, setGenerando] = useState(false)
  const [optimizando, setOptimizando] = useState(false)
  const aprobar = puede(perfil, 'marketing', 'aprobar')
  const puedeDocs = puede(perfil, 'documentos_tecnicos', 'crear') || puede(perfil, 'documentos_tecnicos', 'editar')
  const enlace = `https://${WEB}/equipo/?id=${encodeURIComponent(prod.codigo)}`

  const cargarGaleria = useCallback(() => {
    supabase.from('producto_galeria').select('id,tipo,archivo_url,descripcion,orden,tipo_video').eq('producto_id', prod.id).is('deleted_at', null).order('orden')
      .then(({ data }) => setGaleria((data as GalItem[]) ?? []))
  }, [prod.id])
  const cargarDocs = useCallback(() => {
    supabase.from('documentos_tecnicos').select('id,tipo,nombre,url').eq('producto_id', prod.id).is('deleted_at', null).order('created_at', { ascending: false })
      .then(({ data }) => setDocs((data as DocTecnico[]) ?? []))
  }, [prod.id])
  const cargarFicha = useCallback(() => {
    supabase.from('fichas_tecnicas').select('version,url,fecha').eq('producto_id', prod.id).order('version', { ascending: false }).limit(1).maybeSingle()
      .then(({ data }) => setFicha((data as Ficha) ?? null))
  }, [prod.id])

  useEffect(() => {
    supabase.from('productos').select('nombre,marca,codigo_unico,garantia,accesorios,certificaciones,caracteristicas,especificaciones,destacados,ficha_tecnica_url,pvp,aplica_iva,en_catalogo,imagen_url,drive_carpeta_url,descripcion,categoria:categorias(nombre)').eq('id', prod.id).single()
      .then(({ data }) => { const d = data as unknown as Record<string, any> | null; if (!d) return // eslint-disable-line @typescript-eslint/no-explicit-any
        const f: ProdFull = { nombre: d.nombre ?? '', categoria: d.categoria?.nombre ?? '', marca: d.marca ?? '', codigo_unico: d.codigo_unico ?? '', garantia: d.garantia ?? '', accesorios: d.accesorios ?? '', certificaciones: d.certificaciones ?? '', caracteristicas: d.caracteristicas ?? '', especificaciones: d.especificaciones ?? '', destacados: d.destacados ?? '', ficha_tecnica_url: d.ficha_tecnica_url ?? '', pvp: Number(d.pvp) || 0, aplica_iva: d.aplica_iva !== false, en_catalogo: !!d.en_catalogo, imagen_url: d.imagen_url ?? '', descripcion: d.descripcion ?? '', drive_carpeta_url: d.drive_carpeta_url ?? '' }
        setFull(f)
        setBase({ nombre: f.nombre, categoria: f.categoria, marca: f.marca, modelo: f.codigo_unico, garantia: f.garantia, accesorios: f.accesorios, certificaciones: f.certificaciones, caracteristicas: f.caracteristicas, especificaciones: f.especificaciones, imagen_url: f.imagen_url, descripcion: f.descripcion, album: f.drive_carpeta_url, ficha: f.ficha_tecnica_url, publico: f.en_catalogo ? 'SI' : 'NO', nuevo: prod.sin_etiqueta_nuevo ? 'SI' : 'NO' })
      })
    cargarGaleria()
    cargarDocs()
    cargarFicha()
  }, [prod.id, cargarGaleria, cargarDocs, cargarFicha])

  const especs = useMemo<Especificacion[]>(() => {
    if (!full) return []
    return full.especificaciones.split('\n').map((l) => { const i = l.indexOf(':'); return i > 0 ? { dato: l.slice(0, i).trim(), valor: l.slice(i + 1).trim() } : null }).filter(Boolean) as Especificacion[]
  }, [full])
  const destacadosSel = full?.destacados ? full.destacados.split('|').filter(Boolean) : []

  function toggleDestacado(dato: string) {
    if (!full) return
    const on = destacadosSel.includes(dato)
    if (!on && destacadosSel.length >= 3) { aviso('Elige máximo 3 datos destacados.'); return }
    const nuevos = (on ? destacadosSel.filter((x) => x !== dato) : [...destacadosSel, dato]).join('|')
    set('destacados', nuevos)
    guardarCampo('destacados', nuevos)
  }

  function fichaVistaPrevia() {
    if (!full) return
    const html = construirFichaHtml(full, prod.codigo, destacadosSel, especs, ajustes)
    const blob = new Blob([`<!doctype html><html><head><meta charset="utf-8"><title>Ficha técnica</title></head><body style="margin:0;background:#e2e8f0">${html}</body></html>`], { type: 'text/html;charset=utf-8' })
    window.open(URL.createObjectURL(blob), '_blank', 'noopener')
  }

  async function fichaGenerar() {
    if (!full || fichaFaltan.length) return
    setGenerando(true)
    try {
      const html2pdf = (await import('html2pdf.js')).default
      const htmlStr = construirFichaHtml(full, prod.codigo, destacadosSel, especs, ajustes)
      const blob = await html2pdf().set({
        margin: 0, image: { type: 'jpeg', quality: 0.96 },
        html2canvas: { scale: 2, useCORS: true, allowTaint: false, logging: false, windowWidth: 794 },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
      }).from(htmlStr, 'string').toPdf().output('blob') as Blob
      const base64 = await new Promise<string>((ok, fail) => {
        const r = new FileReader()
        r.onerror = () => fail(new Error('No se pudo leer el PDF.'))
        r.onload = () => ok(String(r.result).split(',')[1] || '')
        r.readAsDataURL(blob)
      })
      const { resp: data, error } = await drive({ accion: 'subir', modulo: 'marketing', carpeta: 'fichas_tecnicas/' + prod.codigo, nombre: 'Ficha tecnica ' + prod.codigo + '.pdf', mime: 'application/pdf', base64 })
      const resp = data as { id?: string; enlace?: string; error?: string } | null
      if (error || resp?.error || !resp?.enlace) { aviso('No se pudo subir la ficha: ' + (resp?.error || error?.message)); return }
      const nuevaVersion = (ficha?.version ?? 0) + 1
      await supabase.from('fichas_tecnicas').insert({ id: crypto.randomUUID(), producto_id: prod.id, version: nuevaVersion, url: resp.enlace, drive_id: resp.id, generada_por: perfil.id, anterior_url: ficha?.url ?? null })
      await supabase.from('productos').update({ ficha_tecnica_url: resp.enlace }).eq('id', prod.id)
      set('ficha_tecnica_url', resp.enlace)
      setBase((b) => ({ ...b, ficha: resp.enlace as string }))
      setFicha({ version: nuevaVersion, url: resp.enlace, fecha: new Date().toISOString() })
      aviso('Ficha técnica generada (versión ' + nuevaVersion + ').')
    } catch (e) {
      aviso('No se pudo generar la ficha: ' + (e as Error).message)
    } finally {
      setGenerando(false)
    }
  }

  async function fichaSubirManual(file: File | null) {
    if (!file) return
    if (file.size > 20 * 1024 * 1024) { aviso('El archivo supera los 20 MB.'); return }
    const base64 = await new Promise<string>((ok, fail) => {
      const r = new FileReader()
      r.onerror = () => fail(new Error('No se pudo leer el archivo.'))
      r.onload = () => ok(String(r.result).split(',')[1] || '')
      r.readAsDataURL(file)
    })
    const { resp: data, error } = await drive({ accion: 'subir', modulo: 'marketing', carpeta: 'fichas_tecnicas/' + prod.codigo, nombre: file.name, mime: file.type || 'application/pdf', base64 })
    const resp = data as { id?: string; enlace?: string; error?: string } | null
    if (error || resp?.error || !resp?.enlace) { aviso('No se pudo subir: ' + (resp?.error || error?.message)); return }
    await guardarCampo('ficha', resp.enlace)
    const nuevaVersion = (ficha?.version ?? 0) + 1
    await supabase.from('fichas_tecnicas').insert({ id: crypto.randomUUID(), producto_id: prod.id, version: nuevaVersion, url: resp.enlace, drive_id: resp.id, generada_por: perfil.id, anterior_url: ficha?.url ?? null })
    setFicha({ version: nuevaVersion, url: resp.enlace, fecha: new Date().toISOString() })
  }

  async function optimizarAlt() {
    const faltan = galeria.filter((g) => !(g.descripcion ?? '').trim())
    if (!faltan.length) { aviso('Todas las fotos y videos ya tienen texto alternativo.'); return }
    setOptimizando(true)
    try {
      const r = await llamar<{ textos: string[] }>('ia_alt_texto', { id: prod.id, n: faltan.length, tipos: faltan.map((g) => g.tipo) })
      await Promise.all(faltan.map((g, i) => supabase.from('producto_galeria').update({ descripcion: r.textos[i] }).eq('id', g.id)))
      cargarGaleria()
      aviso('Texto alternativo generado para ' + faltan.length + ' elemento' + (faltan.length === 1 ? '' : 's') + '.')
    } catch (e) {
      aviso((e as Error).message)
    } finally {
      setOptimizando(false)
    }
  }

  async function docSubir(files: FileList | null) {
    if (!files || !files.length) return
    setDocSubiendo(true)
    let ultimoPdf = ''
    try {
      for (const f of Array.from(files)) {
        if (f.size > 20 * 1024 * 1024) { aviso(f.name + ' supera los 20 MB.'); continue }
        const base64 = await new Promise<string>((ok, fail) => {
          const r = new FileReader()
          r.onerror = () => fail(new Error('No se pudo leer el archivo.'))
          r.onload = () => ok(String(r.result).split(',')[1] || '')
          r.readAsDataURL(f)
        })
        const { resp: data, error } = await drive({ accion: 'subir', modulo: 'documentos_tecnicos', carpeta: 'documentos_tecnicos/' + prod.codigo, nombre: f.name, mime: f.type || 'application/octet-stream', base64 })
        const resp = data as { id?: string; enlace?: string; error?: string } | null
        if (error || resp?.error) { aviso('No se pudo subir ' + f.name + ': ' + (resp?.error || error?.message)); continue }
        const idDoc = crypto.randomUUID()
        const { error: eIns } = await supabase.from('documentos_tecnicos').insert({ id: idDoc, producto_id: prod.id, tipo: docTipo, nombre: f.name, drive_id: resp?.id, url: resp?.enlace, subido_por: perfil.id })
        if (!eIns && (f.type === 'application/pdf' || /\.pdf$/i.test(f.name))) ultimoPdf = idDoc
      }
      cargarDocs()
    } finally {
      setDocSubiendo(false)
    }
    // Con un PDF nuevo, la IA lo lee y propone los campos del producto (se revisan antes de guardar).
    if (ultimoPdf) completarIA(ultimoPdf)
  }
  async function completarIA(docId?: string) {
    setIaCompMsg('La IA está leyendo los documentos técnicos… (puede tardar hasta un minuto)')
    try {
      const r = await llamar<PropuestaIA>('ia_completar', { id: prod.id, docId: docId || null })
      const actual = (k: keyof ProdFull) => String(full?.[k] ?? '').trim()
      const sel: Record<string, boolean> = {}, val: Record<string, string> = {}
      for (const [c, k] of CAMPOS_IA) { const v = String(r.propuesta?.[c] ?? '').trim(); val[c] = v; sel[c] = !!v && !actual(k) && v !== actual(k) }
      setIaComp({ ...r, sel, val })
    } catch (e) { aviso('IA: ' + (e as Error).message) }
    setIaCompMsg('')
  }
  async function aplicarIA() {
    if (!iaComp) return
    const campos = CAMPOS_IA.filter(([c]) => iaComp.sel[c] && iaComp.val[c].trim())
    if (!campos.length) { aviso('Marca al menos un campo.'); return }
    setAplicandoIa(true)
    for (const [c, k] of campos) { const v = iaComp.val[c].trim(); set(k, v as never); await guardarCampo(c, v) }
    setAplicandoIa(false); setIaComp(null)
    aviso(campos.length + ' campo' + (campos.length === 1 ? '' : 's') + ' completado' + (campos.length === 1 ? '' : 's') + ' con IA' + (aprobar ? '.' : ' (los cambios que requieren aprobación quedan en Revisión).'))
  }

  const listaGal = (l: GalItem[]) => JSON.stringify(l.map((g) => ({ archivo: g.archivo_url, tipo: g.tipo, tipoVideo: g.tipo_video ?? '', texto: g.descripcion ?? '' })))
  function registrarGaleria(antes: GalItem[], despues: GalItem[]) {
    supabase.rpc('mkt_registrar_directo', { p_producto: prod.id, p_campo: 'galeria', p_anterior: listaGal(antes), p_nuevo: listaGal(despues) }).then(() => undefined)
  }
  async function galAgregar() {
    const url = nuevoUrl.trim()
    if (!url) return
    const orden = galeria.length ? Math.max(...galeria.map((g) => g.orden)) + 1 : 0
    const nuevo: GalItem = { id: crypto.randomUUID(), tipo: nuevoTipo as GalItem['tipo'], archivo_url: url, orden, descripcion: null }
    const { error } = await supabase.from('producto_galeria').insert({ ...nuevo, producto_id: prod.id })
    if (error) { aviso('No se pudo agregar: ' + error.message); return }
    registrarGaleria(galeria, [...galeria, nuevo])
    setNuevoUrl(''); cargarGaleria()
  }
  const [subiendoGal, setSubiendoGal] = useState('')
  async function galSubir(files: FileList | null) {
    if (!files || !files.length) return
    const antes = [...galeria], nuevos: GalItem[] = []
    let orden = galeria.length ? Math.max(...galeria.map((g) => g.orden)) + 1 : 0
    const lista = Array.from(files)
    for (const [k, f] of lista.entries()) {
      setSubiendoGal(`Subiendo ${k + 1} de ${lista.length}…`)
      try {
        let url = '', tipo: GalItem['tipo'] = 'imagen'
        if (f.type.startsWith('image/')) url = await subirCatalogo(await imagenWebp(f), 'productos/' + prod.codigo + '/galeria', 'webp', 'image/webp')
        else if (/^video\/(mp4|webm|quicktime)$/.test(f.type)) {
          if (f.size > 50 * 1048576) throw new Error(f.name + ' pesa más de 50 MB: súbelo a YouTube y pega el enlace.')
          url = await subirCatalogo(f, 'productos/' + prod.codigo + '/galeria', (f.name.split('.').pop() || 'mp4').toLowerCase().replace(/[^a-z0-9]/g, ''), f.type); tipo = 'video'
        } else throw new Error(f.name + ': formato no admitido (JPG, PNG, WebP, MP4, WebM o MOV).')
        const nuevo: GalItem = { id: crypto.randomUUID(), tipo, archivo_url: url, orden: orden++, descripcion: null }
        const { error } = await supabase.from('producto_galeria').insert({ ...nuevo, producto_id: prod.id })
        if (error) throw new Error(error.message)
        nuevos.push(nuevo)
      } catch (e) { aviso((e as Error).message) }
    }
    setSubiendoGal('')
    if (nuevos.length) { registrarGaleria(antes, [...antes, ...nuevos]); cargarGaleria(); aviso(nuevos.length + ' archivo' + (nuevos.length === 1 ? '' : 's') + ' agregado' + (nuevos.length === 1 ? '' : 's') + ' a la galería.') }
  }
  async function galTipoVideo(id: string, tipoVideo: string) {
    const { error } = await supabase.from('producto_galeria').update({ tipo_video: tipoVideo || null }).eq('id', id)
    if (error) { aviso('No se pudo guardar: ' + error.message); return }
    registrarGaleria(galeria, galeria.map((g) => (g.id === id ? { ...g, tipo_video: tipoVideo || null } : g)))
    setGaleria((l) => l.map((g) => (g.id === id ? { ...g, tipo_video: tipoVideo || null } : g)))
  }
  const [subiendoImg, setSubiendoImg] = useState(false)
  async function subirImagenPrincipal(f: File | undefined) {
    if (!f || !full) return
    setSubiendoImg(true)
    try {
      const url = await subirCatalogo(await imagenWebp(f), 'productos/' + prod.codigo, 'webp', 'image/webp')
      set('imagen_url', url)
      await guardarCampo('imagen_url', url)
    } catch (e) { aviso((e as Error).message) }
    setSubiendoImg(false)
  }
  async function galQuitar(id: string) {
    // Con la función de la base: quien edita la multimedia (sin "eliminar") puede quitar fotos; queda como borrado lógico.
    const { error } = await supabase.rpc('galeria_quitar', { p_id: id })
    if (error) { aviso('No se pudo quitar: ' + error.message); return }
    registrarGaleria(galeria, galeria.filter((g) => g.id !== id))
    cargarGaleria()
  }
  async function galMover(idx: number, dir: -1 | 1) {
    const otro = idx + dir
    if (otro < 0 || otro >= galeria.length) return
    const a = galeria[idx], b = galeria[otro]
    await Promise.all([
      supabase.from('producto_galeria').update({ orden: b.orden }).eq('id', a.id),
      supabase.from('producto_galeria').update({ orden: a.orden }).eq('id', b.id),
    ])
    const despues = [...galeria]; despues[idx] = b; despues[otro] = a
    registrarGaleria(galeria, despues)
    cargarGaleria()
  }
  async function galDescripcion(id: string, descripcion: string) {
    const antes = galeria.find((g) => g.id === id)
    if (!antes || (antes.descripcion ?? '') === descripcion.trim()) return
    await supabase.from('producto_galeria').update({ descripcion: descripcion.trim() || null }).eq('id', id)
    registrarGaleria(galeria, galeria.map((g) => (g.id === id ? { ...g, descripcion: descripcion.trim() || null } : g)))
  }
  function abrirAvPicker() {
    setAvPicker(true)
    supabase.from('audiovisual').select('id,titulo,archivo_url,tipo').eq('producto_id', prod.id).not('archivo_url', 'is', null).is('deleted_at', null).order('fecha', { ascending: false }).limit(20)
      .then(({ data }) => setAvLista((data as { id: string; titulo: string; archivo_url: string; tipo: string }[]) ?? []))
  }
  async function galDesdeAudiovisual(a: { archivo_url: string; tipo: string }) {
    const orden = galeria.length ? Math.max(...galeria.map((g) => g.orden)) + 1 : 0
    const nuevo: GalItem = { id: crypto.randomUUID(), tipo: a.tipo === 'Foto' ? 'imagen' : 'video', archivo_url: a.archivo_url, orden, descripcion: null }
    const { error } = await supabase.from('producto_galeria').insert({ ...nuevo, producto_id: prod.id })
    if (error) { aviso('No se pudo agregar: ' + error.message); return }
    registrarGaleria(galeria, [...galeria, nuevo])
    cargarGaleria(); setAvPicker(false)
  }

  async function guardarCampo(campo: string, valorNuevo: string) {
    const valorAnterior = base[campo] ?? ''
    if (valorNuevo === valorAnterior) return
    setEstado((e) => ({ ...e, [campo]: 'guardando' }))
    // Directo (Coordinación, publicación directa, fotos y etiquetas, correcciones pequeñas) o a Revisión.
    const { data, error } = await supabase.rpc('mkt_cambiar_campo', { p_producto: prod.id, p_campo: campo, p_valor: valorNuevo })
    if (error) { setEstado((e) => ({ ...e, [campo]: 'error' })); setMsg('No se pudo guardar ' + campo + ': ' + error.message); return }
    const r = (data ?? {}) as { pendiente?: boolean; reenviado?: boolean }
    setEstado((e) => ({ ...e, [campo]: r.pendiente ? 'revision' : 'ok' }))
    setBase((b) => ({ ...b, [campo]: valorNuevo }))
    if (r.reenviado) aviso('Corrección reenviada a Coordinación.')
  }

  function set<K extends keyof ProdFull>(k: K, v: ProdFull[K]) { setFull((x) => (x ? { ...x, [k]: v } : x)) }
  function campoTexto(campo: string, k: keyof ProdFull, etiqueta: string, opts: { full?: boolean; lista?: string[]; placeholder?: string; multilinea?: boolean; filas?: number; maxLength?: number } = {}) {
    if (!full) return null
    const valor = String(full[k] ?? '')
    const St = estado[campo]
    const comun = { value: valor, maxLength: opts.maxLength, placeholder: opts.placeholder, className: 'inp w-full', list: opts.lista ? campo + 'Lst' : undefined }
    return (
      <label className={'mkf-lbl' + (opts.full ? ' sm:col-span-2' : '')}>
        <span className="flex items-center gap-1.5">{etiqueta}
          {St === 'guardando' && <RefreshCw className="w-3 h-3 animate-spin text-slate-400" />}
          {St === 'ok' && <CircleCheck className="w-3 h-3 text-emerald-600" />}
          {St === 'revision' && <span className="text-[9px] font-bold text-amber-700">enviado a revisión</span>}
          {St === 'error' && <span className="text-[9px] font-bold text-red-600">no se guardó</span>}
        </span>
        {opts.multilinea
          ? <textarea rows={opts.filas ?? 2} {...comun} onChange={(e) => set(k, e.target.value)} onBlur={() => guardarCampo(campo, valor)} />
          : <input type="text" {...comun} onChange={(e) => set(k, e.target.value)} onBlur={() => guardarCampo(campo, valor)} />}
        {opts.lista && <datalist id={campo + 'Lst'}>{opts.lista.map((o) => <option key={o} value={o} />)}</datalist>}
      </label>
    )
  }

  async function cambiarPublico(nuevo: boolean) {
    if (!full) return
    const anterior = full.en_catalogo
    set('en_catalogo', nuevo)
    setEstado((e) => ({ ...e, publico: 'guardando' }))
    const { data, error } = await supabase.rpc('mkt_cambiar_campo', { p_producto: prod.id, p_campo: 'publico', p_valor: nuevo ? 'SI' : 'NO' })
    if (error) { setEstado((e) => ({ ...e, publico: 'error' })); setMsg('No se pudo cambiar: ' + error.message); set('en_catalogo', anterior); return }
    const r = (data ?? {}) as { pendiente?: boolean }
    setEstado((e) => ({ ...e, publico: r.pendiente ? 'revision' : 'ok' }))
    setBase((b) => ({ ...b, publico: nuevo ? 'SI' : 'NO' }))
    if (r.pendiente) { set('en_catalogo', anterior); aviso('Enviado a Revisión: ' + (nuevo ? 'mostrar' : 'ocultar') + ' en la web.') }
  }

  function toggleNuevo() {
    const nuevo = !sinNuevo
    setSinNuevo(nuevo)
    guardarCampo('nuevo', nuevo ? 'SI' : 'NO')
  }

  const [leyendoFicha, setLeyendoFicha] = useState(false)
  const [espAntes, setEspAntes] = useState<string | null>(null)
  /** Especificaciones tomadas de la ficha técnica en PDF con IA (mkIAEspecificaciones). */
  async function extraerEspecificaciones() {
    if (!full) return
    if (!full.ficha_tecnica_url) { aviso('Primero sube o pega la ficha técnica en PDF.'); return }
    setLeyendoFicha(true); setMsg('La IA está leyendo el PDF… (10 a 30 segundos)')
    try {
      const r = await llamar<{ especificaciones: string[] }>('ia_especificaciones', { id: prod.id })
      const texto = r.especificaciones.join('\n')
      setEspAntes(full.especificaciones)
      set('especificaciones', texto)
      await guardarCampo('especificaciones', texto)
      setMsg('Listo: ' + r.especificaciones.length + ' datos tomados de la ficha. Revísalos.')
    } catch (e) { setMsg((e as Error).message) }
    setLeyendoFicha(false)
  }
  async function redactar() {
    setIa(true); setMsg('')
    try {
      const r = await llamar<{ descripcion: string; caracteristicas: string[]; conFicha: boolean }>('ia_producto', { id: prod.id, notas })
      const car = r.caracteristicas.join('\n')
      set('descripcion', r.descripcion); set('caracteristicas', car)
      await Promise.all([guardarCampo('descripcion', r.descripcion), guardarCampo('caracteristicas', car)])
      setMsg(r.conFicha ? 'Redactado con los datos de la ficha técnica.' : 'Redactado sin ficha técnica legible: revisa que no falte nada.')
    } catch (e) { setMsg((e as Error).message) }
    setIa(false)
  }

  const falta = full ? [!full.imagen_url && 'Imagen principal', !full.nombre.trim() && 'Nombre', !full.categoria.trim() && 'Categoría', !full.marca.trim() && 'Marca', !full.descripcion.trim() && 'Descripción', !full.caracteristicas.trim() && 'Características', !full.especificaciones.trim() && 'Especificaciones técnicas', galeria.filter((g) => g.tipo === 'imagen').length < 3 && 'Al menos 3 fotos'].filter(Boolean) as string[] : []
  const fotosOk = galeria.filter((g) => g.tipo === 'imagen').length >= 3
  const fichaFaltan = full ? [!full.imagen_url && 'Imagen principal', !full.descripcion.trim() && 'Descripción', !full.especificaciones.trim() && 'Especificaciones técnicas', !fotosOk && 'Al menos 3 fotos', !full.caracteristicas.trim() && 'Características'].filter(Boolean) as string[] : []
  const seo = full ? (() => {
    const avisos = [
      { ok: full.nombre.trim().length > 8, texto: 'Nombre descriptivo (qué es + marca/modelo)' },
      { ok: !!full.marca.trim(), texto: 'Marca registrada' },
      { ok: !!full.categoria.trim(), texto: 'Categoría' },
      { ok: full.descripcion.trim().length >= 120, texto: 'Descripción de al menos 120 caracteres' },
      { ok: !!full.nombre.trim().split(' ')[0] && normalize(full.descripcion).includes(normalize(full.nombre.trim().split(' ')[0])), texto: 'La descripción menciona el nombre del equipo' },
      { ok: full.caracteristicas.split('\n').filter((x) => x.trim()).length >= 3, texto: 'Al menos 3 características' },
      { ok: especs.length >= 3, texto: 'Al menos 3 especificaciones técnicas' },
      { ok: !!full.imagen_url, texto: 'Imagen principal' },
      { ok: fotosOk, texto: 'Al menos 3 fotos en la galería' },
      { ok: galeria.some((g) => g.tipo === 'video'), texto: 'Al menos un video' },
      { ok: galeria.length === 0 || galeria.every((g) => (g.descripcion ?? '').trim()), texto: 'Texto alternativo en todas las fotos y videos' },
    ]
    return { puntaje: Math.round((avisos.filter((a) => a.ok).length / avisos.length) * 100), avisos }
  })() : null

  return (
    <Ventana titulo={prod.nombre} cerrar={cerrar} ancho="sm:max-w-6xl" pie={<>
      <p className={'text-[11px] font-semibold flex-1 ' + (falta.length ? 'text-amber-700' : 'text-emerald-700')}>{falta.length ? 'Falta: ' + falta.join(', ') : '✓ Producto completo'}<span className="block font-normal text-slate-400">{msg || 'Todo se guarda solo'}</span></p>
      <button className="btn btn-primary" onClick={cerrar}><Check />Listo</button>
    </>}>
      <div className="mkf-editor">
      {encabezado}
      <div className="mkf-top">
      {full && (
        <div className="flex items-center gap-3 rounded-xl border border-slate-200 p-3" style={full.en_catalogo ? { background: '#f0fdf8', borderColor: '#bfe6da' } : undefined}>
          <span className="w-9 h-9 rounded-lg grid place-items-center shrink-0" style={full.en_catalogo ? { background: '#dcfce7', color: '#04896f' } : { background: '#f1f5f9', color: '#94a3b8' }}><Globe className="w-4 h-4" /></span>
          <div className="min-w-0 flex-1"><p className="text-[12.5px] font-bold text-slate-800">Visible al público</p><p className="text-[11px] text-slate-500">{full.en_catalogo ? 'Se muestra en la web y en los catálogos.' : 'No se muestra en la web ni en los catálogos.'}</p></div>
          <Interruptor activo={full.en_catalogo} cambiar={() => cambiarPublico(!full.en_catalogo)} />
        </div>
      )}

      <div className="flex items-center gap-2.5 rounded-xl border border-slate-200 bg-slate-50/70 p-2.5 min-w-0">
        {full?.imagen_url ? <img src={imagen(full.imagen_url, 96)} alt="" className="w-11 h-11 rounded-lg object-contain bg-white border border-slate-200 shrink-0" /> : <span className="w-11 h-11 rounded-lg bg-white border border-slate-200 shrink-0 grid place-items-center text-slate-300"><ImagePlus className="w-4 h-4" /></span>}
        <div className="min-w-0 flex-1"><p className="text-[10.5px] font-mono-spec text-slate-400 truncate">{prod.codigo}{full?.categoria ? ' · ' + full.categoria : ''}</p><p className="text-[11.5px] font-semibold text-[var(--primary)] truncate" title={enlace}>{enlace.replace('https://', '')}</p></div>
        <button type="button" className="btn !py-1.5 !px-2" title="Copiar enlace para compartir" onClick={() => { navigator.clipboard.writeText(enlace); aviso('Enlace copiado.') }}><Copy className="w-3.5 h-3.5" /></button>
        <button type="button" className="btn !py-1.5 !px-2" title="Vista previa en la web" onClick={() => window.open(enlace, '_blank', 'noopener')}><Eye className="w-3.5 h-3.5" /></button>
      </div>
      {prodReciente(prod) && (
        <div className="flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50/60 px-3 py-2">
          <span className="text-[9px] font-bold uppercase tracking-wider text-white rounded-full px-2 py-0.5 shrink-0" style={{ background: '#c98a1f', opacity: sinNuevo ? .35 : 1, textDecoration: sinNuevo ? 'line-through' : undefined }}>Nuevo</span>
          <p className="text-[11.5px] text-slate-600 flex-1 min-w-0">{sinNuevo ? 'Etiqueta "Nuevo" quitada. Este equipo ya no se marca como nuevo.' : 'Se muestra como "Nuevo" en el catálogo mientras sea reciente.'}</p>
          <button type="button" className="btn !py-1.5 shrink-0" onClick={toggleNuevo}><Tag className="w-3.5 h-3.5" />{sinNuevo ? 'Volver a mostrar' : 'Quitar etiqueta'}</button>
        </div>
      )}

      </div>
      {!full ? <p className="text-xs text-slate-400">Cargando el producto…</p> : (
      <div className="mkf-2col">
        <div className="mkf-col">
      <div className="mkf-caja">
      {full && (
        <div className="space-y-2">
          <div className="flex items-center gap-2"><p className="text-xs font-bold text-slate-800 flex items-center gap-1.5"><Tag className="w-3.5 h-3.5 text-[var(--primary)]" />Datos del producto</p>
            <span className="ml-auto text-[11px] text-slate-500">PVP {money(full.pvp)} {full.aplica_iva ? '' : '(sin IVA)'} <span className="text-slate-400">(solo lectura)</span></span></div>
          <div className="grid sm:grid-cols-2 gap-2">
            {campoTexto('nombre', 'nombre', 'Nombre', { full: true })}
            {campoTexto('categoria', 'categoria', 'Categoría', { lista: categorias })}
            {campoTexto('marca', 'marca', 'Marca', { lista: marcas })}
            {campoTexto('modelo', 'codigo_unico', 'Modelo')}
            {campoTexto('garantia', 'garantia', 'Garantía', { placeholder: 'Ej. 1 año' })}
            {campoTexto('accesorios', 'accesorios', 'Incluye (accesorios, uno por línea)', { full: true, multilinea: true, maxLength: 1200 })}
            {campoTexto('certificaciones', 'certificaciones', 'Certificaciones', { full: true, placeholder: 'ISO 13485 · CE · ARCSA' })}
          </div>
          {!aprobar && <p className="text-[10.5px] text-slate-400">Se guarda solo mientras escribes. Los cambios pasan a Revisión.</p>}
        </div>
      )}

      </div>
      <div className="rounded-xl border border-violet-200 bg-violet-50/60 p-3 space-y-2">
        <p className="text-[11px] font-bold text-violet-700 flex items-center gap-1.5"><Sparkles className="w-3.5 h-3.5" />Redactar con IA</p>
        <input value={notas} onChange={(e) => setNotas(e.target.value)} className="inp w-full" placeholder="Indicaciones (opcional): enfoque, público, qué resaltar…" />
        <button type="button" className="btn" onClick={redactar} disabled={ia}><Sparkles />{ia ? 'Redactando…' : 'Redactar descripción y características'}</button>
        <p className="text-[10px] text-slate-500">Si el producto tiene ficha técnica en PDF, la IA la lee para no inventar datos.</p>
      </div>
      <div className="mkf-caja">
        <p className="text-xs font-bold text-slate-800 flex items-center gap-1.5"><FileText className="w-3.5 h-3.5 text-[var(--primary)]" />Textos del producto</p>
      {full && campoTexto('descripcion', 'descripcion', 'Descripción', { full: true, multilinea: true, filas: 3 })}
      {full && campoTexto('caracteristicas', 'caracteristicas', 'Características (una por línea, se muestran con ✓)', { full: true, multilinea: true, filas: 5, maxLength: 3400 })}
      {full && campoTexto('especificaciones', 'especificaciones', 'Especificaciones técnicas (una por línea: Dato: valor)', { full: true, multilinea: true, filas: 6, maxLength: 4000 })}
      {full && <div className="flex items-center gap-2 flex-wrap -mt-1">
        <button type="button" className="btn" onClick={extraerEspecificaciones} disabled={leyendoFicha}><FileText className="w-3.5 h-3.5" />{leyendoFicha ? 'Leyendo la ficha…' : 'Extraer de la ficha técnica con IA'}</button>
        {espAntes !== null && !leyendoFicha && <button type="button" className="btn" onClick={() => { set('especificaciones', espAntes); guardarCampo('especificaciones', espAntes); setEspAntes(null) }}>Deshacer</button>}
      </div>}

      </div>
        </div>
        <div className="mkf-col">
      <div className="mkf-caja">
      {full && (
        <div className="space-y-2">
          <p className="text-xs font-bold text-slate-800 flex items-center gap-1.5"><ImagePlus className="w-3.5 h-3.5 text-[var(--primary)]" />Imagen principal<span className="ml-auto text-[10px] font-normal text-slate-400">4:3, fondo claro · se guarda en WebP</span></p>
          <div className="flex items-center gap-3">
            <label className="shrink-0 cursor-pointer" title="Cambiar la imagen principal">
              {full.imagen_url ? <img src={imagen(full.imagen_url, 160)} alt="" className="w-16 h-16 rounded-lg object-contain bg-slate-50 border border-slate-200" onError={(e) => { e.currentTarget.style.visibility = 'hidden' }} /> : <span className="w-16 h-16 rounded-lg border border-dashed border-slate-300 grid place-items-center text-slate-400"><ImagePlus className="w-5 h-5" /></span>}
              <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" disabled={subiendoImg} onChange={(e) => { subirImagenPrincipal(e.target.files?.[0]); e.target.value = '' }} />
            </label>
            <div className="min-w-0 flex-1" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label className="btn !py-1.5 cursor-pointer" style={{ alignSelf: 'flex-start' }}><Upload className="w-3.5 h-3.5" />{subiendoImg ? 'Subiendo imagen…' : 'Subir imagen'}
                <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" disabled={subiendoImg} onChange={(e) => { subirImagenPrincipal(e.target.files?.[0]); e.target.value = '' }} /></label>
              <input type="url" className="inp w-full" placeholder="O pega un enlace de Drive / HTTPS" value={full.imagen_url} onChange={(e) => set('imagen_url', e.target.value)} onBlur={() => guardarCampo('imagen_url', full.imagen_url)} />
            </div>
          </div>
        </div>
      )}
      </div>
      <div className="mkf-caja">
      <div className="space-y-2">
        <div className="flex items-center gap-2"><p className="text-xs font-bold text-slate-800 flex items-center gap-1.5"><ImagePlus className="w-3.5 h-3.5 text-[var(--cyan)]" />Galería del catálogo</p>
          <span className="ml-auto text-[10px] font-mono-spec text-slate-400">{galeria.length} elemento{galeria.length === 1 ? '' : 's'}</span></div>
        <p className="text-[11px] text-slate-500">Fotos y videos que se ven en el catálogo después de la imagen principal. Se guarda solo.</p>
        {galeria.length > 0 && (
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
            {galeria.map((g, i) => (
              <div key={g.id} className="rounded-xl border border-slate-200 overflow-hidden bg-slate-50">
                <button type="button" className="aspect-square w-full grid place-items-center bg-slate-100 relative" style={{ cursor: 'zoom-in', padding: 0, border: 0 }} onClick={() => setVisor(i)} title="Ver en grande">
                  {g.tipo === 'video'
                    ? <Video className="w-6 h-6 text-slate-400" />
                    : <img src={imagen(g.archivo_url, 200)} alt="" className="w-full h-full object-cover" onError={(e) => { e.currentTarget.style.visibility = 'hidden' }} />}
                </button>
                <input type="text" defaultValue={g.descripcion ?? ''} onBlur={(e) => galDescripcion(g.id, e.target.value)} placeholder="Descripción" className="w-full text-[9px] px-1.5 py-1 border-t border-slate-200 bg-white" />
                {g.tipo === 'video' && <select value={g.tipo_video ?? ''} onChange={(e) => galTipoVideo(g.id, e.target.value)} className="w-full text-[9px] px-1 py-1 border-t border-slate-200 bg-white" aria-label="Tipo de video"><option value="">Tipo de video…</option>{TIPOS_VIDEO.map((t) => <option key={t}>{t}</option>)}</select>}
                <div className="flex items-center gap-0.5 px-1 pb-1">
                  <button type="button" className="w-5 h-5 grid place-items-center text-slate-400 hover:text-slate-700 disabled:opacity-30" onClick={() => galMover(i, -1)} disabled={i === 0} title="Mover antes"><ArrowUp className="w-3 h-3" /></button>
                  <button type="button" className="w-5 h-5 grid place-items-center text-slate-400 hover:text-slate-700 disabled:opacity-30" onClick={() => galMover(i, 1)} disabled={i === galeria.length - 1} title="Mover después"><ArrowDown className="w-3 h-3" /></button>
                  <button type="button" className="ml-auto w-5 h-5 grid place-items-center text-red-500 hover:text-red-700" onClick={() => galQuitar(g.id)} title="Quitar"><Trash2 className="w-3 h-3" /></button>
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <select className="inp !py-1.5" value={nuevoTipo} onChange={(e) => setNuevoTipo(e.target.value as 'imagen' | 'video')}><option value="imagen">Foto</option><option value="video">Video</option></select>
          <input type="url" className="inp flex-1 min-w-[180px]" placeholder={nuevoTipo === 'video' ? 'Enlace de YouTube/Vimeo' : 'Enlace de Drive/HTTPS'} value={nuevoUrl} onChange={(e) => setNuevoUrl(e.target.value)} />
          <button type="button" className="btn" onClick={galAgregar}><ImagePlus className="w-3.5 h-3.5" />Agregar</button>
          <button type="button" className="btn" onClick={abrirAvPicker}><Film className="w-3.5 h-3.5" />Desde Audiovisual</button>
          <label className="btn" style={{ cursor: 'pointer' }}><Upload className="w-3.5 h-3.5" />{subiendoGal || 'Subir fotos o videos'}<input type="file" multiple hidden accept="image/jpeg,image/png,image/webp,video/mp4,video/webm,video/quicktime" disabled={!!subiendoGal} onChange={(e) => { galSubir(e.target.files); e.target.value = '' }} /></label>
        </div>
        {visor !== null && galeria.length > 0 && <VisorMedios medios={galeria.map((g) => ({ tipo: g.tipo, url: g.archivo_url, descripcion: g.descripcion }))} inicio={visor} cerrar={() => setVisor(null)} />}
        {avPicker && (
          <div className="rounded-xl border border-slate-200 p-2 space-y-1">
            {!avLista.length && <p className="text-[11px] text-slate-400 text-center py-2">Sin piezas de Audiovisual para este producto.</p>}
            {avLista.map((a) => (
              <button type="button" key={a.id} className="flex items-center gap-2 w-full text-left p-1.5 rounded-lg hover:bg-slate-50" onClick={() => galDesdeAudiovisual(a)}>
                <span className="w-8 h-8 rounded-md bg-slate-100 grid place-items-center shrink-0">{a.tipo === 'Foto' ? <ImagePlus className="w-3.5 h-3.5 text-slate-400" /> : <Video className="w-3.5 h-3.5 text-slate-400" />}</span>
                <span className="text-xs text-slate-700 truncate flex-1">{a.titulo}</span>
              </button>
            ))}
            <button type="button" className="text-[10px] text-slate-400 underline px-1.5" onClick={() => setAvPicker(false)}>Cerrar</button>
          </div>
        )}
      </div>

      </div>
      <div className="mkf-caja">
      {full && (
        <div className="space-y-2">
          <p className="text-xs font-bold text-slate-800 flex items-center gap-1.5"><FileText className="w-3.5 h-3.5 text-[var(--teal)]" />Ficha técnica</p>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-1.5">
            <div className="grid sm:grid-cols-2 gap-x-3 gap-y-1">
              {['Imagen principal', 'Descripción', 'Especificaciones técnicas', 'Al menos 3 fotos', 'Características'].map((t) => (
                <div key={t} className={'flex items-center gap-1.5 text-[11.5px] ' + (fichaFaltan.includes(t) ? 'text-red-600' : 'text-emerald-700')}>
                  <span className="font-bold">{fichaFaltan.includes(t) ? '✕' : '✓'}</span>{t}
                </div>
              ))}
            </div>
            {fichaFaltan.length === 0
              ? <p className="text-[11px] font-semibold text-emerald-700">✓ Completo: la ficha se puede generar.</p>
              : <p className="text-[11px] text-slate-500">La ficha se puede generar cuando esté todo lo obligatorio.</p>}
            {ficha && <p className="text-[11px] text-slate-500">Versión {ficha.version} · {new Date(ficha.fecha).toLocaleString('es-EC', { dateStyle: 'short', timeStyle: 'short' })} · <a href={ficha.url} target="_blank" rel="noopener noreferrer" className="font-bold text-[var(--primary)]">Abrir PDF</a></p>}
            <div className="flex gap-2 flex-wrap">
              <button type="button" className="btn !py-1.5" onClick={fichaVistaPrevia}><Eye className="w-3.5 h-3.5" />Vista previa</button>
              {aprobar && <button type="button" className="btn btn-primary !py-1.5" onClick={fichaGenerar} disabled={generando || fichaFaltan.length > 0}><RefreshCw className="w-3.5 h-3.5" />{generando ? 'Generando…' : 'Generar ahora'}</button>}
            </div>
          </div>

          {especs.length > 0 && (
            <div className="space-y-1">
              <p className="text-[11px] font-semibold text-slate-600">Datos destacados de la ficha (elige hasta 3)</p>
              <div className="flex flex-wrap gap-1.5">
                {especs.slice(0, 18).map((e) => (
                  <button type="button" key={e.dato} onClick={() => toggleDestacado(e.dato)}
                    className={'text-[10.5px] font-semibold px-3 py-1.5 rounded-full border ' + (destacadosSel.includes(e.dato) ? 'bg-[var(--primary)] text-white border-[var(--primary)]' : 'bg-white text-slate-500 border-slate-200 hover:border-slate-300')}>
                    {e.dato}
                  </button>
                ))}
              </div>
              {!destacadosSel.length && <p className="text-[10.5px] text-slate-400">Sin elegir: se usan las 3 primeras.</p>}
            </div>
          )}

          {aprobar && (
            <div className="space-y-1.5">
              <p className="text-[11px] font-semibold text-slate-600">Solo Coordinación: enlace manual (se reemplaza la próxima vez que se genere la ficha)</p>
              <div className="flex gap-2 items-center">
                <input type="url" className="inp flex-1" placeholder="Enlace de la ficha" value={full.ficha_tecnica_url} onChange={(e) => set('ficha_tecnica_url', e.target.value)} onBlur={() => guardarCampo('ficha', full.ficha_tecnica_url)} />
                {full.ficha_tecnica_url && <a href={full.ficha_tecnica_url} target="_blank" rel="noopener noreferrer" className="btn !py-1.5">Abrir ↗</a>}
              </div>
              <label className="btn cursor-pointer !py-1.5 inline-flex"><Upload className="w-3.5 h-3.5" />Elegir PDF
                <input type="file" accept="application/pdf" className="hidden" onChange={(e) => { fichaSubirManual(e.target.files?.[0] ?? null); e.target.value = '' }} /></label>
            </div>
          )}
        </div>
      )}

      </div>
      <div className="mkf-caja">
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <p className="text-xs font-bold text-slate-800 flex items-center gap-1.5"><FileBadge className="w-3.5 h-3.5 text-[var(--teal)]" />Documentos técnicos</p>
          <span className={'ml-auto pill ' + (docs.length === 0 ? 'bg-red-50 text-red-600' : DOC_OBLIGATORIOS.every((t) => docs.some((d) => d.tipo === t)) ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700')}>
            {docs.length === 0 ? 'Sin documentos' : DOC_OBLIGATORIOS.every((t) => docs.some((d) => d.tipo === t)) ? 'Completo' : 'Incompleto'}
          </span>
        </div>
        <div className="space-y-1">
          {docs.map((d) => (
            <div key={d.id} className="flex items-center gap-2 text-[11.5px] text-slate-600">
              <FileText className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              {d.url ? <a href={d.url} target="_blank" rel="noopener noreferrer" className="text-[var(--primary)] font-semibold">{d.tipo}</a> : <span>{d.tipo}</span>}
              <span className="text-slate-400 truncate">{d.nombre}</span>
            </div>
          ))}
          {!docs.length && <p className="text-[11px] text-slate-400">Sin documentos técnicos todavía.</p>}
          {(() => { const faltan = DOC_OBLIGATORIOS.filter((t) => !docs.some((d) => d.tipo === t)); return faltan.length > 0 && <p className="text-[11px] text-slate-500">Falta: {faltan.join(', ')}. Los sube Servicio Técnico.</p> })()}
        </div>
        {puedeDocs && (
          <div className="flex gap-2 items-center flex-wrap">
            <select className="inp !py-1.5" value={docTipo} onChange={(e) => setDocTipo(e.target.value)}>{DOC_TIPOS.map((t) => <option key={t}>{t}</option>)}</select>
            <label className="btn cursor-pointer !py-1.5"><Upload className="w-3.5 h-3.5" />{docSubiendo ? 'Subiendo…' : 'Elegir archivos'}
              <input type="file" multiple className="hidden" disabled={docSubiendo} onChange={(e) => { docSubir(e.target.files); e.target.value = '' }} /></label>
          </div>
        )}
        {(docs.length > 0 || !!full?.ficha_tecnica_url) && (
          <div className="mkia-caja">
            <button type="button" className="btn" onClick={() => completarIA()} disabled={!!iaCompMsg}><Sparkles />{iaCompMsg ? 'Leyendo documentos…' : 'Completar campos con IA'}</button>
            <span>{iaCompMsg || 'La IA lee la hoja de datos y los manuales y propone descripción, características, especificaciones, accesorios, certificaciones y más. Al subir un PDF lo hace sola.'}</span>
          </div>
        )}
        {iaComp && (
          <Ventana titulo="Completar con IA · revisa antes de guardar" ancho="sm:max-w-6xl" cerrar={() => setIaComp(null)} pie={<>
            <p className="text-[11px] text-slate-500 flex-1">Se guardan solo los campos marcados. {aprobar ? '' : 'Los cambios que requieren aprobación pasan a Revisión.'}</p>
            <button type="button" className="btn" onClick={() => setIaComp(null)}>Cancelar</button>
            <button type="button" className="btn btn-primary" onClick={aplicarIA} disabled={aplicandoIa}><Check />{aplicandoIa ? 'Guardando…' : 'Aplicar ' + CAMPOS_IA.filter(([c]) => iaComp.sel[c] && iaComp.val[c].trim()).length + ' campos'}</button>
          </>}>
            <div className="mkia-info">
              <p><Sparkles /><b>Leyó:</b> {iaComp.leidos.join(' · ')}</p>
              {iaComp.omitidos.length > 0 && <p className="omit">No pudo leer: {iaComp.omitidos.join(' · ')}</p>}
              {iaComp.notas && <p className="nota">{iaComp.notas}</p>}
            </div>
            {CAMPOS_IA.map(([c, k, t]) => {
              const ahora = String(full?.[k] ?? '').trim(), prop = iaComp.val[c] ?? ''
              if (!String(iaComp.propuesta?.[c] ?? '').trim()) return null
              const igual = prop.trim() === ahora
              return (
                <div key={c} className={'mkia-campo' + (iaComp.sel[c] ? ' on' : '')}>
                  <label className="mkia-h">
                    <input type="checkbox" checked={!!iaComp.sel[c]} disabled={igual} onChange={(e) => setIaComp((x) => x && { ...x, sel: { ...x.sel, [c]: e.target.checked } })} />
                    <b>{t}</b>
                    <span className={'mkia-tag ' + (igual ? 'igual' : ahora ? 'reemplaza' : 'nuevo')}>{igual ? 'Sin cambios' : ahora ? 'Reemplaza lo actual' : 'Campo vacío: se llena'}</span>
                  </label>
                  <div className="mkia-cols">
                    <div><small>Ahora</small><div className="mkia-ahora">{ahora || '—'}</div></div>
                    <div><small>Propuesta de la IA (puedes editarla)</small>
                      <textarea className="inp w-full" rows={Math.min(12, Math.max(2, prop.split('\n').length + 1))} value={prop}
                        onChange={(e) => { const v = e.target.value; setIaComp((x) => x && { ...x, val: { ...x.val, [c]: v }, sel: { ...x.sel, [c]: true } }) }} /></div>
                  </div>
                </div>
              )
            })}
          </Ventana>
        )}
      </div>

      </div>
      <div className="mkf-caja">
      {full && (
        <div className="space-y-2">
          <p className="text-xs font-bold text-slate-800 flex items-center gap-1.5"><Link2 className="w-3.5 h-3.5 text-amber-500" />Álbum de multimedia</p>
          <div className="flex gap-2 items-center">
            <input type="url" className="inp flex-1" placeholder="Carpeta de Google Drive" value={full.drive_carpeta_url} onChange={(e) => set('drive_carpeta_url', e.target.value)} onBlur={() => guardarCampo('album', full.drive_carpeta_url)} />
            {full.drive_carpeta_url && <a href={full.drive_carpeta_url} target="_blank" rel="noopener noreferrer" className="btn !py-1.5">Abrir ↗</a>}
          </div>
          <p className="text-[10px] text-slate-400">Archivo interno en Drive. No se muestra en el catálogo cuando la galería ya tiene fotos.</p>
        </div>
      )}

      </div>
      <div className="mkf-caja">
      {seo && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <p className="text-xs font-bold text-slate-800 flex items-center gap-1.5"><Search className="w-3.5 h-3.5 text-[var(--primary)]" />Revisión SEO</p>
            <span className={'ml-auto pill ' + (seo.puntaje >= 80 ? 'bg-emerald-50 text-emerald-700' : seo.puntaje >= 50 ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red-600')}>{seo.puntaje} / 100</span>
          </div>
          <ul className="space-y-1">
            {seo.avisos.map((a, i) => (
              <li key={i} className="flex items-start gap-1.5 text-[11.5px]">
                <span className={'font-bold ' + (a.ok ? 'text-emerald-600' : 'text-red-500')}>{a.ok ? '✓' : '✕'}</span>
                <span className={a.ok ? 'text-slate-500' : 'text-slate-700'}>{a.texto}</span>
              </li>
            ))}
          </ul>
          <button type="button" className="btn !py-1.5" onClick={optimizarAlt} disabled={optimizando}><Sparkles className="w-3.5 h-3.5" />{optimizando ? 'Optimizando…' : 'Optimizar textos alternativos ahora'}</button>
        </div>
      )}
      </div>
        </div>
      </div>
      )}
      </div>
    </Ventana>
  )
}

/* ============================ Revisión (aprobaciones) ============================ */
/* La Revisión del equipo está en MarketingRevision.tsx. */

/* ============================ Google Drive ============================ */
/* Formas de conectar (supabase/functions/drive y google-oauth):
   · «Conectar con Google» (recomendada): autorización OAuth; se elige la cuenta, se da «Permitir» y queda conectado.
   · «Con mi cuenta de Google»: un script de Apps Script de la cuenta de la empresa (como la app original) entrega a la app un
     permiso temporal de Drive. Sirve cuando Google no deja descargar la clave JSON de la cuenta de servicio (política de Workspace).
   · «Cuenta de servicio»: la clave JSON, como antes. */
const idUnidad = (v: string) => { const m = v.match(/folders\/([\w-]+)/) || v.match(/[?&]id=([\w-]+)/); return (m ? m[1] : v).trim() }
const URL_PUENTE = /^https:\/\/script\.google\.com\/(a\/macros\/[^/\s]+|macros)\/s\/[\w-]+\/exec$/
const claveNueva = () => { const b = crypto.getRandomValues(new Uint8Array(18)); return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') }
const codigoPuente = (clave: string) => `/** Puente VIMEDIC ↔ Google Drive.
 *  Entrega a la app web de VIMEDIC un permiso temporal (1 hora) de esta cuenta para usar Google Drive,
 *  igual que hacía la app original. Solo responde a quien conoce la clave. */
var CLAVE = '${clave}';

function doPost(e) {
  var datos = {};
  try { datos = JSON.parse((e && e.postData && e.postData.contents) || '{}'); } catch (err) {}
  if (datos.clave !== CLAVE) return responder_({ error: 'Clave incorrecta.' });
  return responder_({ token: ScriptApp.getOAuthToken(), cuenta: Session.getEffectiveUser().getEmail() });
}

/** Ejecútala una vez desde el editor para conceder el permiso de Drive. */
function autorizar() {
  Logger.log('Drive autorizado para ' + Session.getEffectiveUser().getEmail() + ' · espacio usado: ' + DriveApp.getStorageUsed());
}

/** No se ejecuta: solo declara el permiso completo de Drive (crear y editar archivos). */
function permisos_() {
  DriveApp.createFolder('x');
}

function responder_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
`
/** Cliente de OAuth que ya usa el inicio de sesión con Google (proyecto vimedic-crm, supabase/config.toml): sirve también para Drive. */
const CLIENTE_GOOGLE_LOGIN = '984059782625-khhkbk6cbig0tfo89vv21i2i3k52c7i5.apps.googleusercontent.com'
const URI_GOOGLE = String(import.meta.env.VITE_SUPABASE_URL || '').replace(/\/$/, '') + '/functions/v1/google-oauth'
type Modo = 'oauth' | 'puente' | 'cuenta'
function TarjetaDrive({ est, estApp, aviso, cambio }: { est: Estado; estApp: Estado; aviso: (t: string) => void; cambio: () => void }) {
  const cfg = est.config as { driveId?: string; modo?: Modo; cuenta?: string }
  const cfgApp = estApp.config as { client_id?: string }
  const [modo, setModo] = useState<Modo>(cfg.modo ?? (est.configurado ? 'cuenta' : 'oauth'))
  const [json, setJson] = useState('')
  const [unidad, setUnidad] = useState(cfg.driveId ?? '')
  const [urlPuente, setUrlPuente] = useState('')
  const [clave, setClave] = useState(claveNueva)
  const [clienteId, setClienteId] = useState(cfgApp.client_id ?? CLIENTE_GOOGLE_LOGIN)
  const [clienteSecreto, setClienteSecreto] = useState('')
  const [ocupado, setOcupado] = useState('')
  const [cuenta, setCuenta] = useState('')
  const esperando = useRef(false)
  const prueba = est.estado_prueba ?? '', ok = prueba.startsWith('ok')
  const guardadoComoPuente = est.configurado && cfg.modo === 'puente'
  const conectadoOAuth = est.configurado && cfg.modo === 'oauth'

  /* La ventana de Google termina en /conexion-lista.html, que avisa aquí (mensaje o, si Google cortó el vínculo, almacenamiento local). */
  const probarRef = useRef<() => void>(() => undefined)
  useEffect(() => {
    const terminar = (d: { fuente?: string; proveedor?: string; ok?: boolean; texto?: string } | null) => {
      if (!d || d.fuente !== 'vimedic-oauth' || d.proveedor !== 'drive' || !esperando.current) return
      esperando.current = false; setOcupado('')
      aviso(d.ok ? 'Google Drive autorizado. Probando la conexión…' : 'No se pudo conectar: ' + (d.texto || 'sin detalle'))
      cambio()
      if (d.ok) probarRef.current()
    }
    const alMensaje = (e: MessageEvent) => { if (e.origin === window.location.origin) terminar(e.data) }
    const alGuardar = (e: StorageEvent) => { if (e.key === 'vm_oauth_resultado' && e.newValue) { try { terminar(JSON.parse(e.newValue)) } catch { /* inválido */ } } }
    window.addEventListener('message', alMensaje); window.addEventListener('storage', alGuardar)
    return () => { window.removeEventListener('message', alMensaje); window.removeEventListener('storage', alGuardar) }
  }, [aviso, cambio])

  function leerArchivo(f: File | undefined) { if (!f) return; const r = new FileReader(); r.onload = () => setJson(String(r.result)); r.readAsText(f) }
  async function copiar(texto: string, msg: string) {
    try { await navigator.clipboard.writeText(texto); aviso(msg) } catch { aviso('No se pudo copiar: selecciónalo y cópialo a mano.') }
  }
  async function guardarApp() {
    const id = clienteId.trim(), sec = clienteSecreto.trim()
    if (!/^[\w-]+\.apps\.googleusercontent\.com$/.test(id)) { aviso('El ID de cliente termina en .apps.googleusercontent.com.'); return }
    if (!sec && !estApp.configurado) { aviso('Pega el secreto del cliente de OAuth.'); return }
    setOcupado('app')
    const { error } = await supabase.rpc('integracion_guardar', { p_proveedor: 'google_app', p_secreto: sec ? JSON.stringify({ client_id: id, client_secret: sec }) : null, p_config: { client_id: id } })
    setOcupado('')
    if (error) { aviso('No se pudo guardar: ' + error.message); return }
    if (!sec && cfgApp.client_id && cfgApp.client_id !== id) aviso('Cambiaste el ID de cliente: pega también su secreto.')
    else aviso('App de Google guardada. Ahora pulsa «Conectar con Google».')
    setClienteSecreto(''); cambio()
  }
  async function conectarGoogle() {
    if (!idUnidad(unidad)) { aviso('Primero pega el ID de la unidad compartida «VIMEDIC Sistema».'); return }
    // La ventana se abre en el mismo clic (si no, el navegador la bloquea) y luego se le pone el enlace de Google.
    const w = window.open('', 'vm_oauth', 'width=520,height=720')
    setOcupado('conectar')
    try {
      if (cfg.driveId !== idUnidad(unidad) || cfg.modo !== 'oauth') {
        const { error } = await supabase.rpc('integracion_guardar', { p_proveedor: 'drive', p_secreto: null, p_config: { ...cfg, driveId: idUnidad(unidad), modo: 'oauth' } })
        if (error) throw new Error(error.message)
      }
      const r = await llamar<{ enlace: string }>('iniciar', { origen: window.location.origin }, 'google-oauth')
      esperando.current = true
      if (w) w.location.href = r.enlace
      else window.location.href = r.enlace   // ventanas emergentes bloqueadas: se autoriza en esta misma pestaña
    } catch (e) { w?.close(); setOcupado(''); aviso((e as Error).message) }
  }
  async function guardar() {
    let secreto: string | null = null
    if (modo === 'puente') {
      const u = urlPuente.trim(), c = clave.trim()
      if (u || !guardadoComoPuente) {
        if (!URL_PUENTE.test(u)) { aviso('Pega la «URL de la aplicación web» del script: empieza con https://script.google.com/ y termina en /exec.'); return }
        if (c.length < 16) { aviso('La clave del puente debe tener al menos 16 caracteres (la misma que está en el código del script).'); return }
        secreto = JSON.stringify({ tipo: 'puente', url: u, clave: c })
      }
    } else if (modo === 'cuenta') {
      if (json.trim()) { try { const j = JSON.parse(json); if (!j.client_email || !j.private_key) throw new Error('x') } catch { aviso('Ese archivo no parece el JSON de una cuenta de servicio de Google.'); return } secreto = json.trim() }
      else if (!est.configurado || cfg.modo === 'puente' || cfg.modo === 'oauth') { aviso('Pega o sube el archivo JSON de la cuenta de servicio.'); return }
    }
    if (!idUnidad(unidad)) { aviso('Falta el ID de la unidad compartida.'); return }
    setOcupado('guardar')
    const { error } = await supabase.rpc('integracion_guardar', { p_proveedor: 'drive', p_secreto: secreto, p_config: { ...cfg, driveId: idUnidad(unidad), modo: modo === 'oauth' ? (cfg.modo ?? 'oauth') : modo } })
    setOcupado('')
    if (error) { aviso('No se pudo guardar: ' + error.message); return }
    setJson(''); setUrlPuente(''); cambio()
    if (secreto || est.configurado) { aviso('Drive guardado. Probando…'); probar() } else aviso('Unidad guardada. Ahora pulsa «Conectar con Google».')
  }
  async function probar() {
    setOcupado('probar')
    try { const r = await llamar<{ mensaje: string; cuenta: string }>('probar', { escribir: true }, 'drive'); setCuenta(r.cuenta); aviso(r.mensaje) }
    catch (e) { aviso((e as Error).message) }
    setOcupado(''); cambio()
  }
  probarRef.current = probar
  async function quitar() {
    if (!confirm('¿Desconectar Google Drive?')) return
    const { error } = await supabase.rpc('integracion_quitar', { p_proveedor: 'drive' })
    if (error) aviso('No se pudo quitar: ' + error.message); else { setCuenta(''); aviso('Drive desconectado.'); cambio() }
  }
  const pestaña = (m: Modo, t: string) => (
    <button type="button" className="btn !py-1.5" onClick={() => setModo(m)}
      style={modo === m ? { background: '#0f9d58', borderColor: '#0f9d58', color: '#fff' } : undefined}>{t}</button>
  )
  return (
    <article className="card p-5" style={{ gridColumn: "1 / -1" }}>
      <div className="flex items-start gap-3">
        <span className="w-10 h-10 rounded-xl grid place-items-center shrink-0" style={{ background: '#0f9d581A', color: '#0f9d58' }}><Plug className="w-5 h-5" /></span>
        <div className="min-w-0 flex-1"><h3 className="font-display font-bold text-sm text-slate-800">Google Drive · documentos y multimedia</h3><p className="text-[11px] text-slate-500">Guarda PDF, facturas, evidencias, fotos y videos en la unidad compartida «VIMEDIC Sistema» o en una carpeta de Drive.</p></div>
        <span className="pill shrink-0" style={est.configurado ? (prueba && !ok ? { background: '#fdecea', color: '#c0392b' } : { background: '#ecfaf5', color: '#04896f' }) : { background: '#f1f5f9', color: '#64748b' }}>{est.configurado ? (prueba ? (ok ? 'Conectado' : 'Con error') : 'Sin probar') : 'No conectado'}</span>
      </div>

      <label className="block text-[11px] font-bold text-slate-500 mt-3">ID o enlace de la unidad compartida o de una carpeta<input className="inp w-full mt-1" value={unidad} onChange={(e) => setUnidad(e.target.value)} placeholder="Ej. 0AB1cD2eF3gH4iUk9PVA (el final del enlace …/folders/ID)" /></label>

      <div className="flex gap-2 flex-wrap mt-3">
        {pestaña('oauth', 'Conectar con Google (recomendado)')}
        {pestaña('puente', 'Con un script de Apps Script')}
        {pestaña('cuenta', 'Cuenta de servicio (clave JSON)')}
      </div>

      {modo === 'oauth' && (
        <>
          <p className="text-[11px] text-slate-500 mt-3">Pulsas <b>Conectar con Google</b>, eliges la cuenta de la empresa (la que tiene la unidad «VIMEDIC Sistema»), das <b>Permitir</b> y queda conectado. Sin clave JSON.</p>
          <div className="flex items-center gap-2 flex-wrap mt-3">
            <button type="button" className="btn btn-primary" onClick={conectarGoogle} disabled={!!ocupado || !estApp.configurado}><Plug />{ocupado === 'conectar' ? 'Esperando la autorización…' : conectadoOAuth ? 'Volver a conectar con Google' : 'Conectar con Google'}</button>
            {conectadoOAuth && cfg.cuenta && <span className="text-[11px] text-slate-500">Conectado con <b>{cfg.cuenta}</b></span>}
            {!estApp.configurado && <span className="text-[11px] font-semibold" style={{ color: '#b45309' }}>Primero completa «App de Google (una sola vez)».</span>}
          </div>
          <details className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3" open={!estApp.configurado}>
            <summary className="text-[11px] font-bold text-slate-600 cursor-pointer">App de Google (una sola vez){estApp.configurado ? ' · guardada' : ' · pendiente'}</summary>
            <ol className="text-[11px] text-slate-600 mt-2 list-decimal pl-4 space-y-1">
              <li>Entra a <a className="underline font-semibold" href="https://console.cloud.google.com/apis/library/drive.googleapis.com" target="_blank" rel="noopener noreferrer">Google Cloud › Google Drive API</a> con la cuenta de la empresa, en el proyecto <b>vimedic-crm</b> (el del inicio de sesión con Google), y pulsa <b>Habilitar</b>.</li>
              <li>En <a className="underline font-semibold" href="https://console.cloud.google.com/auth/scopes" target="_blank" rel="noopener noreferrer">Google Auth Platform › Acceso a los datos</a> › <b>Agregar o quitar permisos</b> › marca <b>…/auth/drive</b> (Google Drive API) › Actualizar › Guardar. Si el público es <b>Interno</b>, Google no pide verificación.</li>
              <li>En <a className="underline font-semibold" href="https://console.cloud.google.com/auth/clients" target="_blank" rel="noopener noreferrer">Clientes</a> abre el cliente web de VIMEDIC (el ID de abajo) › <b>URI de redireccionamiento autorizados</b> › Agregar URI › pega la de abajo › Guardar.</li>
              <li>En ese mismo cliente pulsa <b>Agregar secreto</b> (o copia el que ya tiene) y pégalo abajo › <b>Guardar app de Google</b>.</li>
            </ol>
            <label className="block text-[11px] font-bold text-slate-500 mt-3">URI de redireccionamiento (cópiala en Google)
              <div className="flex gap-2 mt-1"><input readOnly className="inp flex-1 font-mono-spec text-[11px]" value={URI_GOOGLE} onFocus={(e) => e.currentTarget.select()} /><button type="button" className="btn" onClick={() => copiar(URI_GOOGLE, 'URI copiada.')}><Copy />Copiar</button></div></label>
            <label className="block text-[11px] font-bold text-slate-500 mt-3">ID de cliente
              <input className="inp w-full mt-1 font-mono-spec text-[11px]" value={clienteId} onChange={(e) => setClienteId(e.target.value.trim())} /></label>
            <label className="block text-[11px] font-bold text-slate-500 mt-3">Secreto del cliente{estApp.configurado && <span className="font-normal text-slate-400"> · ya hay uno guardado; pega otro solo para reemplazarlo</span>}
              <input type="password" autoComplete="off" className="inp w-full mt-1 font-mono-spec" value={clienteSecreto} onChange={(e) => setClienteSecreto(e.target.value.trim())} placeholder="GOCSPX-…" /></label>
            <button type="button" className="btn btn-primary mt-3" onClick={guardarApp} disabled={!!ocupado}><Check />{ocupado === 'app' ? 'Guardando…' : 'Guardar app de Google'}</button>
          </details>
        </>
      )}

      {modo === 'puente' && (
        <>
          <p className="text-[11px] text-slate-500 mt-3">Alternativa sin Google Cloud: como la app original, un pequeño script de la cuenta de la empresa le da a la app el permiso de Drive.</p>
          <ol className="text-[11px] text-slate-600 mt-2 list-decimal pl-4 space-y-1">
            <li>Entra a <a className="underline font-semibold" href="https://script.google.com/home/projects/create" target="_blank" rel="noopener noreferrer">script.google.com › Nuevo proyecto</a> con la cuenta que tiene acceso a la unidad «VIMEDIC Sistema». Ponle de nombre «Puente Drive VIMEDIC».</li>
            <li>Borra lo que trae el editor, pega el código (botón <b>Copiar código</b>) y guarda con Ctrl+S.</li>
            <li>Arriba elige la función <b>autorizar</b> › <b>Ejecutar</b> › Revisar permisos › tu cuenta › <b>Permitir</b>. Si aparece «Google no verificó esta app»: Configuración avanzada › Ir a Puente Drive VIMEDIC.</li>
            <li><b>Implementar › Nueva implementación</b> › tipo <b>Aplicación web</b> · Ejecutar como: <b>Yo</b> · Quién tiene acceso: <b>Cualquier usuario</b> › Implementar. Copia la <b>URL de la aplicación web</b> (termina en /exec), pégala abajo y pulsa <b>Guardar</b>.</li>
          </ol>
          <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
            <div className="flex items-end gap-2 flex-wrap">
              <label className="text-[11px] font-bold text-slate-500 flex-1 min-w-[220px]">Clave del puente (va dentro del código)
                <input className="inp w-full mt-1 font-mono-spec" value={clave} onChange={(e) => setClave(e.target.value.replace(/['"\\\s]/g, ''))} /></label>
              <button type="button" className="btn" onClick={() => setClave(claveNueva())} title="Generar otra clave"><RefreshCw />Otra</button>
              <button type="button" className="btn btn-primary" onClick={() => copiar(codigoPuente(clave), 'Código copiado. Pégalo en un proyecto nuevo de script.google.com.')}><Copy />Copiar código</button>
            </div>
            <textarea readOnly className="inp w-full mt-2 font-mono-spec text-[10.5px]" rows={6} value={codigoPuente(clave)} onFocus={(e) => e.currentTarget.select()} />
            {guardadoComoPuente && <p className="text-[10.5px] text-slate-400 mt-1">Ya hay un puente guardado. Para cambiarlo, pega la nueva URL y deja aquí la misma clave que tiene el script.</p>}
          </div>
          <label className="block text-[11px] font-bold text-slate-500 mt-3">URL de la aplicación web del script
            <input className="inp w-full mt-1" value={urlPuente} onChange={(e) => setUrlPuente(e.target.value.trim())} placeholder="https://script.google.com/macros/s/…/exec" /></label>
        </>
      )}

      {modo === 'cuenta' && (
        <>
          <ol className="text-[11px] text-slate-500 mt-3 list-decimal pl-4 space-y-0.5">
            <li>En Google Cloud crea una <b>cuenta de servicio</b> y descarga su clave en formato <b>JSON</b>. (Si Google no deja crear la clave, usa «Conectar con Google».)</li>
            <li>En la unidad compartida «VIMEDIC Sistema» › Administrar miembros agrega el correo de la cuenta de servicio como <b>Gestor de contenido</b>.</li>
          </ol>
          <label className="block text-[11px] font-bold text-slate-500 mt-3">Clave de la cuenta de servicio (JSON){est.configurado && cfg.modo !== 'puente' && cfg.modo !== 'oauth' && <span className="font-normal text-slate-400"> · ya hay una guardada; pega otra solo para reemplazarla</span>}
            <textarea className="inp w-full mt-1 font-mono-spec" rows={4} value={json} onChange={(e) => setJson(e.target.value)} placeholder='{ "type": "service_account", "client_email": "…", "private_key": "…" }' /></label>
          <input type="file" accept="application/json,.json" className="block mt-1 text-xs" onChange={(e) => leerArchivo(e.target.files?.[0])} />
        </>
      )}

      {prueba && <p className="text-[11px] mt-3 rounded-lg px-3 py-2" style={ok ? { background: '#ecfaf5', color: '#04896f' } : { background: '#fdecea', color: '#a3341f' }}>{prueba.replace(/^(ok|error): /, '')}{est.probado_en ? ' · ' + new Date(est.probado_en).toLocaleString('es-EC', { dateStyle: 'short', timeStyle: 'short' }) : ''}</p>}
      {cuenta && <p className="text-[11px] text-slate-500 mt-2">Cuenta con la que se usa Drive: <b>{cuenta}</b></p>}
      <div className="flex gap-2 flex-wrap mt-4">
        <button type="button" className="btn btn-primary" onClick={guardar} disabled={!!ocupado}><Check />{ocupado === 'guardar' ? 'Guardando…' : modo === 'oauth' ? 'Guardar unidad' : 'Guardar'}</button>
        <button type="button" className="btn" onClick={probar} disabled={!!ocupado || !est.configurado}><Plug />{ocupado === 'probar' ? 'Probando…' : 'Probar (crea un archivo de prueba)'}</button>
        {est.configurado && <button type="button" className="btn ml-auto" style={{ color: '#b91c1c', borderColor: '#fecaca' }} onClick={quitar}><Trash2 />Desconectar</button>}
      </div>
    </article>
  )
}
