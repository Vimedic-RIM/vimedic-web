/* Evita la pantalla en blanco.
   · Si al abrir un módulo falta un archivo de la app (pasa cuando se publica una versión nueva mientras alguien trabaja:
     los archivos de la versión anterior ya no existen), la página se recarga sola una vez y abre la versión nueva.
   · Si un módulo falla al mostrarse por otra razón, primero se reintenta solo una vez (los fallos intermitentes, como
     datos que todavía no llegan, casi siempre pasan al segundo intento); si vuelve a fallar se ve el aviso con
     «Volver a intentar» y «Recargar» en lugar de dejar todo en blanco; el resto de la app sigue funcionando.
   · Todo fallo queda registrado (registrar_error_app → errores_app: mensaje, componente, pila, quién y dónde) para
     corregir la causa exacta. Lo lee Seguridad. */
import { Component, type ErrorInfo, type ReactNode } from 'react'
import { supabase } from './supabase'

const esErrorDeCarga = (e: unknown): boolean =>
  /dynamically imported module|Importing a module script failed|module script|Unable to preload CSS|ChunkLoadError|Loading chunk \S+ failed|not a valid JavaScript MIME type/i
    .test(String((e as Error)?.message ?? e))

/** Recarga la página para tomar la versión nueva (como máximo una vez cada 20 s, para no quedar en un bucle). */
export function recargarPorVersionNueva(): boolean {
  try {
    const t = Number(sessionStorage.getItem('vm_recarga_version') || 0)
    if (Date.now() - t < 20000) return false
    sessionStorage.setItem('vm_recarga_version', String(Date.now()))
  } catch { /* sin almacenamiento: se recarga igual */ }
  window.location.reload()
  return true
}

/** Primer componente propio de la pila de React («at Resumen (…)» → «Resumen»), para saber dónde fue. */
const componenteDe = (pila?: string | null) => (String(pila || '').match(/at ([A-Z][\w$]*)/)?.[1] ?? '')

/** Guarda el fallo para revisarlo (sin bloquear nada si no se puede). */
function registrar(donde: string, error: Error, componentes: string) {
  try {
    const version = document.querySelector('script[type="module"][src*="/assets/"]')?.getAttribute('src') ?? ''
    void supabase.rpc('registrar_error_app', { p: {
      donde, mensaje: String(error?.message ?? error).slice(0, 1000), componentes: componentes.trim().split('\n').slice(0, 25).join('\n'),
      pila: String(error?.stack ?? '').split('\n').slice(0, 25).join('\n'), url: location.href.slice(0, 300), version, navegador: navigator.userAgent.slice(0, 300),
    } }).then(() => undefined, () => undefined)
  } catch { /* sin registro */ }
}

type Estado = { error: Error | null; recargando: boolean; reintentando: boolean; componente: string }
export class ErrorPantalla extends Component<{ children: ReactNode; donde?: string }, Estado> {
  state: Estado = { error: null, recargando: false, reintentando: false, componente: '' }
  private ultimoReintento = 0
  private espera: ReturnType<typeof setTimeout> | null = null
  static getDerivedStateFromError(error: Error): Partial<Estado> { return { error } }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Error al mostrar ' + (this.props.donde ?? 'la pantalla') + ':', error, info.componentStack)
    if (esErrorDeCarga(error)) { if (recargarPorVersionNueva()) this.setState({ recargando: true }); return }
    const componente = componenteDe(info.componentStack)
    registrar(this.props.donde ?? 'la pantalla', error, info.componentStack ?? '')
    // Un reintento automático (como máximo uno cada 15 s): si el fallo fue pasajero, no se ve nada.
    if (Date.now() - this.ultimoReintento > 15000) {
      this.ultimoReintento = Date.now()
      this.setState({ reintentando: true, componente })
      this.espera = setTimeout(() => this.setState({ error: null, reintentando: false }), 350)
    } else this.setState({ reintentando: false, componente })
  }
  componentWillUnmount() { if (this.espera) clearTimeout(this.espera) }
  render() {
    const { error, recargando, reintentando, componente } = this.state
    if (!error) return this.props.children
    const caja: React.CSSProperties = { maxWidth: 520, margin: '48px auto', padding: 20, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 16, boxShadow: '0 10px 30px -18px rgba(11,37,69,.45)', fontFamily: 'Inter, sans-serif', color: '#0f172a' }
    const boton = (fondo: string, color: string): React.CSSProperties => ({ border: fondo === '#fff' ? '1px solid #cbd5e1' : 0, background: fondo, color, borderRadius: 10, padding: '9px 14px', fontSize: 13, fontWeight: 700, cursor: 'pointer' })
    if (recargando) return <div style={caja}><p style={{ margin: 0, fontWeight: 700 }}>Hay una versión nueva de la app. Actualizando…</p></div>
    if (reintentando) return <p style={{ textAlign: 'center', fontSize: 12, color: '#94a3b8', padding: 40, fontFamily: 'Inter, sans-serif' }}>Cargando…</p>
    const carga = esErrorDeCarga(error)
    return (
      <div style={caja} role="alert">
        <p style={{ margin: 0, fontWeight: 800, fontSize: 15 }}>{carga ? 'Hay una versión nueva de la app' : 'Algo falló al mostrar ' + (this.props.donde ?? 'esta pantalla')}</p>
        <p style={{ margin: '6px 0 0', fontSize: 13, color: '#475569' }}>{carga ? 'Recarga la página para seguir trabajando. Lo que ya guardaste no se pierde.' : 'Vuelve a intentarlo. El error ya quedó registrado para sistemas.'}</p>
        {!carga && <pre style={{ margin: '10px 0 0', padding: 10, background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, fontSize: 11.5, color: '#b91c1c', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{error.message}{componente ? '\nEn: ' + componente : ''}</pre>}
        <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
          {!carga && <button type="button" style={boton('#fff', '#0f172a')} onClick={() => this.setState({ error: null })}>Volver a intentar</button>}
          <button type="button" style={boton('#055c9d', '#fff')} onClick={() => window.location.reload()}>Recargar la página</button>
        </div>
      </div>
    )
  }
}
